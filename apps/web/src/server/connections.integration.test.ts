import { randomBytes } from "node:crypto";

import { Secret, type Invoice, type SyncInvoicesPayload } from "@bystro/core";
import {
  applyConnectionEvent,
  createDb,
  forOrganization,
  getConnection,
  listConnections,
  listInvoices,
  readConnectionTokens,
  upsertInvoices,
} from "@bystro/db";
import { createTestOrganization, readTestDatabase } from "@bystro/db/testing";
import { afterAll, describe, expect, it } from "vitest";

import {
  chooseFakturoidAccount,
  completeFakturoidConnection,
  ConnectionFlowError,
  disconnect,
  enqueueInitialSync,
  requestManualSync,
  startFakturoidConnection,
  type FlowDeps,
} from "./connections";

const { db, close } = createDb(readTestDatabase().url);
const key = randomBytes(32);
const APP_URL = "https://bystro.example";
const system = { actor: { type: "system" as const }, source: "worker" as const };

afterAll(async () => {
  await close();
});

interface FakeFakturoid {
  accounts: { slug: string; name: string; registration_no: string; allowed_scope?: string[] }[];
  tokenStatus: number;
  requests: { method: string; path: string; body: string; authorization: string | null }[];
}

/** A stand-in for Fakturoid's OAuth and user endpoints. */
function fakeFakturoid(overrides: Partial<FakeFakturoid> = {}) {
  const state: FakeFakturoid = {
    accounts: [{ slug: "dvorak", name: "Dvořák Interiéry", registration_no: "27074358" }],
    tokenStatus: 200,
    requests: [],
    ...overrides,
  };
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    state.requests.push({
      method: init?.method ?? "GET",
      path: url.pathname,
      body: String(init?.body ?? ""),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    if (url.pathname.endsWith("/oauth/token")) {
      return state.tokenStatus === 200
        ? Response.json({
            access_token: "access-token-plain",
            token_type: "Bearer",
            expires_in: 7200,
            refresh_token: "refresh-token-plain",
          })
        : Response.json({ error: "invalid_grant" }, { status: state.tokenStatus });
    }
    if (url.pathname.endsWith("/oauth/revoke")) {
      return Response.json({});
    }
    if (url.pathname.endsWith("/user.json")) {
      return Response.json({
        accounts: state.accounts.map((account) => ({
          permission: "owner",
          allowed_scope: ["invoices", "expenses", "reports"],
          ...account,
        })),
      });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { state, fetchFn };
}

function flow(fetchFn: typeof fetch): FlowDeps {
  return {
    db,
    encryptionKey: key,
    appBaseUrl: APP_URL,
    fetch: fetchFn,
    fakturoid: {
      clientId: "client-id",
      clientSecret: new Secret("client-secret"),
      userAgent: "Bystro (vyvoj@bystro.example)",
    },
  };
}

async function company(name = "Firma A", ico = "27074358") {
  const { organization, owner } = await createTestOrganization(db, name, ico);
  return { organization: { id: organization.id, ico }, userId: owner.id };
}

/** Starts the flow and returns the `state` Fakturoid would send back. */
async function started(deps: FlowDeps, who: Awaited<ReturnType<typeof company>>) {
  const url = new URL(
    await startFakturoidConnection(deps, {
      organizationId: who.organization.id,
      userId: who.userId,
    }),
  );
  return { url, state: url.searchParams.get("state") as string };
}

const callback = (state: string | null, extra: { code?: string | null; error?: string } = {}) => ({
  state,
  code: extra.code === undefined ? "auth-code" : extra.code,
  error: extra.error ?? null,
});

async function flowError(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectionFlowError);
    return (error as ConnectionFlowError).code;
  }
  throw new Error("expected a ConnectionFlowError");
}

describe("connecting Fakturoid", () => {
  it("sends the user to Fakturoid with the documented parameters and nothing secret", async () => {
    const { fetchFn } = fakeFakturoid();
    const who = await company();
    const { url, state } = await started(flow(fetchFn), who);

    expect(`${url.origin}${url.pathname}`).toBe("https://app.fakturoid.cz/api/v3/oauth");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://bystro.example/api/integrations/fakturoid/callback",
    );
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(url.toString()).not.toContain("client-secret");
    expect(url.searchParams.has("scope")).toBe(false);
  });

  it("saves the connection with encrypted tokens and the user's only account", async () => {
    const { state: fakturoid, fetchFn } = fakeFakturoid();
    const deps = flow(fetchFn);
    const who = await company();
    const { state } = await started(deps, who);

    const { connection, needsAccountChoice } = await completeFakturoidConnection(
      deps,
      who,
      callback(state),
    );

    expect(needsAccountChoice).toBe(false);
    expect(connection).toMatchObject({
      provider: "fakturoid",
      category: "invoicing",
      status: "connected",
      externalAccountId: "dvorak",
      displayName: "Dvořák Interiéry",
    });
    // Nothing about the tokens is on the connection itself.
    expect(JSON.stringify(connection)).not.toMatch(/access-token-plain|refresh-token-plain/);
    const tokens = await readConnectionTokens(db, who.organization.id, connection.id, key);
    expect(tokens?.accessToken.reveal()).toBe("access-token-plain");
    expect(tokens?.refreshToken?.reveal()).toBe("refresh-token-plain");

    const exchange = fakturoid.requests.find((request) => request.path.endsWith("/oauth/token"));
    expect(exchange?.body).toContain("grant_type=authorization_code");
    expect(exchange?.body).toContain("code=auth-code");
    expect(exchange?.authorization).toMatch(/^Basic /);

    const audit = await forOrganization(db, who.organization.id).listAuditLogs();
    expect(audit.map((entry) => entry.action)).toContain("integration.connected");
  });

  it("with several accounts picks the one with the company's IČO", async () => {
    const { fetchFn } = fakeFakturoid({
      accounts: [
        { slug: "jina-firma", name: "Jiná firma", registration_no: "45274649" },
        { slug: "dvorak", name: "Dvořák Interiéry", registration_no: "27074358" },
      ],
    });
    const deps = flow(fetchFn);
    const who = await company();
    const { state } = await started(deps, who);

    const { connection, needsAccountChoice } = await completeFakturoidConnection(
      deps,
      who,
      callback(state),
    );
    expect(needsAccountChoice).toBe(false);
    expect(connection.externalAccountId).toBe("dvorak");
  });

  it("asks the user to choose when no account matches, and accepts only a real one", async () => {
    const { fetchFn } = fakeFakturoid({
      accounts: [
        { slug: "klient-a", name: "Klient A", registration_no: "45274649" },
        { slug: "klient-b", name: "Klient B", registration_no: "99999994" },
        {
          slug: "bez-faktur",
          name: "Bez faktur",
          registration_no: "11111111",
          allowed_scope: ["reports"],
        },
      ],
    });
    const deps = flow(fetchFn);
    const who = await company();
    const { state } = await started(deps, who);

    const { connection, needsAccountChoice } = await completeFakturoidConnection(
      deps,
      who,
      callback(state),
    );
    expect(needsAccountChoice).toBe(true);
    expect(connection.externalAccountId).toBeNull();
    const target = {
      organizationId: who.organization.id,
      connectionId: connection.id,
      userId: who.userId,
    };

    // Not sent to the queue until an account is chosen.
    expect(await enqueueInitialSync(async () => true, connection)).toBe(false);
    expect(await chooseFakturoidAccount(deps, target, "vymysleny-ucet")).toBeNull();
    // An account that may not read invoices is not on offer either.
    expect(await chooseFakturoidAccount(deps, target, "bez-faktur")).toBeNull();

    const chosen = await chooseFakturoidAccount(deps, target, "klient-b");
    expect(chosen).toMatchObject({ externalAccountId: "klient-b", displayName: "Klient B" });
    expect(await enqueueInitialSync(async () => true, chosen as NonNullable<typeof chosen>)).toBe(
      true,
    );
  });

  it("refuses a state that is unknown, missing, someone else's or already used", async () => {
    const { state: fakturoid, fetchFn } = fakeFakturoid();
    const deps = flow(fetchFn);
    const who = await company();
    const colleague = await createTestOrganization(db, "Firma B");
    const { state } = await started(deps, who);

    expect(await flowError(completeFakturoidConnection(deps, who, callback("made-up")))).toBe(
      "invalid_state",
    );
    expect(await flowError(completeFakturoidConnection(deps, who, callback(null)))).toBe(
      "invalid_state",
    );
    // The same state presented by another user of another company.
    expect(
      await flowError(
        completeFakturoidConnection(
          deps,
          {
            organization: { id: colleague.organization.id, ico: "27074358" },
            userId: colleague.owner.id,
          },
          callback(state),
        ),
      ),
    ).toBe("invalid_state");
    // …and by another user inside the same company id.
    expect(
      await flowError(
        completeFakturoidConnection(deps, { ...who, userId: colleague.owner.id }, callback(state)),
      ),
    ).toBe("invalid_state");
    expect(fakturoid.requests).toHaveLength(0);

    await completeFakturoidConnection(deps, who, callback(state));
    expect(await flowError(completeFakturoidConnection(deps, who, callback(state)))).toBe(
      "invalid_state",
    );
    expect(
      fakturoid.requests.filter((request) => request.path.endsWith("/oauth/token")),
    ).toHaveLength(1);
    expect(await listConnections(db, colleague.organization.id)).toHaveLength(0);
  });

  it("stores nothing when the user says no or Fakturoid gives no tokens", async () => {
    const denied = fakeFakturoid();
    const who = await company();
    const first = await started(flow(denied.fetchFn), who);
    expect(
      await flowError(
        completeFakturoidConnection(
          flow(denied.fetchFn),
          who,
          callback(first.state, { code: null, error: "access_denied" }),
        ),
      ),
    ).toBe("denied");

    const broken = fakeFakturoid({ tokenStatus: 400 });
    const second = await started(flow(broken.fetchFn), who);
    expect(
      await flowError(
        completeFakturoidConnection(flow(broken.fetchFn), who, callback(second.state)),
      ),
    ).toBe("provider_unavailable");

    expect(await listConnections(db, who.organization.id)).toHaveLength(0);
  });

  it("gives the access back when the user has no account to read invoices from", async () => {
    const { state: fakturoid, fetchFn } = fakeFakturoid({ accounts: [] });
    const deps = flow(fetchFn);
    const who = await company();
    const { state } = await started(deps, who);

    expect(await flowError(completeFakturoidConnection(deps, who, callback(state)))).toBe(
      "no_account",
    );
    const revoke = fakturoid.requests.find((request) => request.path.endsWith("/oauth/revoke"));
    expect(JSON.parse(revoke?.body ?? "{}")).toEqual({ token: "refresh-token-plain" });
    expect(await listConnections(db, who.organization.id)).toHaveLength(0);
  });
});

async function connectedCompany() {
  const fakturoid = fakeFakturoid();
  const deps = flow(fakturoid.fetchFn);
  const who = await company();
  const { state } = await started(deps, who);
  const { connection } = await completeFakturoidConnection(deps, who, callback(state));
  fakturoid.state.requests.length = 0;
  return {
    deps,
    fakturoid: fakturoid.state,
    organizationId: who.organization.id,
    userId: who.userId,
    connectionId: connection.id,
  };
}

describe("requestManualSync", () => {
  it("enqueues one sync and then makes the user wait five minutes", async () => {
    const { organizationId, connectionId } = await connectedCompany();
    const jobs: { data: SyncInvoicesPayload; jobId: string }[] = [];
    const enqueue = async (data: SyncInvoicesPayload, jobId: string) => {
      const fresh = !jobs.some((job) => job.jobId === jobId);
      if (fresh) jobs.push({ data, jobId });
      return fresh;
    };
    const where = { organizationId, connectionId };
    const now = new Date("2026-10-11T08:00:00Z");

    expect(await requestManualSync({ db, enqueue, now }, where)).toBe("enqueued");
    expect(jobs[0]?.data).toEqual({ organizationId, connectionId, mode: "incremental" });
    // A second click in the same slot adds nothing.
    expect(await requestManualSync({ db, enqueue, now }, where)).toBe("too_soon");

    // The worker has started: the next request has to wait from that moment.
    await applyConnectionEvent(db, organizationId, connectionId, "sync_started", system);
    await applyConnectionEvent(db, organizationId, connectionId, "sync_succeeded", system);
    expect(await requestManualSync({ db, enqueue, now: new Date() }, where)).toBe("too_soon");
    expect(
      await requestManualSync({ db, enqueue, now: new Date(Date.now() + 6 * 60_000) }, where),
    ).toBe("enqueued");
    expect(jobs).toHaveLength(2);
  });

  it("refuses a connection that needs reconnecting and one of another company", async () => {
    const { organizationId, connectionId } = await connectedCompany();
    const other = await connectedCompany();
    const enqueue = async () => true;

    expect(
      await requestManualSync(
        { db, enqueue },
        { organizationId: other.organizationId, connectionId },
      ),
    ).toBe("not_found");

    await applyConnectionEvent(db, organizationId, connectionId, "auth_failed", system);
    expect(await requestManualSync({ db, enqueue }, { organizationId, connectionId })).toBe(
      "not_syncable",
    );
  });
});

describe("disconnect", () => {
  const invoice: Invoice = {
    source: "fakturoid",
    externalId: "1",
    sourceUpdatedAt: null,
    number: "2026-01",
    variableSymbol: null,
    kind: "invoice",
    direction: "issued",
    sourceStatus: "open",
    clientExternalId: null,
    issuedOn: "2026-10-01",
    taxableSupplyOn: null,
    dueOn: "2026-10-15",
    paidOn: null,
    currency: "CZK",
    subtotalMinor: 100_000n,
    vatMinor: 0n,
    totalMinor: 100_000n,
    lines: [],
    payments: [],
  };

  it("revokes the access, deletes the tokens and hides the synced invoices", async () => {
    const { deps, fakturoid, organizationId, connectionId, userId } = await connectedCompany();
    await upsertInvoices(db, { organizationId, connectionId }, [invoice]);
    expect(await listInvoices(db, organizationId)).toHaveLength(1);

    expect(await disconnect(deps, { organizationId, connectionId, userId })).toBe(true);

    expect(fakturoid.requests.map((request) => request.path)).toEqual(["/api/v3/oauth/revoke"]);
    expect(JSON.parse(fakturoid.requests[0]?.body ?? "{}")).toEqual({
      token: "refresh-token-plain",
    });
    expect(await readConnectionTokens(db, organizationId, connectionId, key)).toBeNull();
    expect((await getConnection(db, organizationId, connectionId))?.status).toBe("revoked");
    expect(await listInvoices(db, organizationId)).toHaveLength(0);
    // Hidden, not destroyed.
    expect(await listInvoices(db, organizationId, { includeDeleted: true })).toHaveLength(1);
    const audit = await forOrganization(db, organizationId).listAuditLogs();
    expect(audit.map((entry) => entry.action)).toContain("integration.disconnected");

    // Doing it again is harmless and does not call Fakturoid a second time.
    expect(await disconnect(deps, { organizationId, connectionId, userId })).toBe(true);
    expect(fakturoid.requests).toHaveLength(1);
  });

  it("still disconnects when Fakturoid cannot be reached", async () => {
    const { deps, organizationId, connectionId, userId } = await connectedCompany();
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    expect(
      await disconnect({ ...deps, fetch: offline }, { organizationId, connectionId, userId }),
    ).toBe(true);
    expect(await readConnectionTokens(db, organizationId, connectionId, key)).toBeNull();
  });

  it("cannot touch a connection of another company", async () => {
    const mine = await connectedCompany();
    const theirs = await connectedCompany();

    expect(
      await disconnect(mine.deps, {
        organizationId: mine.organizationId,
        connectionId: theirs.connectionId,
        userId: mine.userId,
      }),
    ).toBe(false);
    expect((await getConnection(db, theirs.organizationId, theirs.connectionId))?.status).toBe(
      "connected",
    );
    expect(
      await readConnectionTokens(db, theirs.organizationId, theirs.connectionId, key),
    ).not.toBeNull();
  });
});

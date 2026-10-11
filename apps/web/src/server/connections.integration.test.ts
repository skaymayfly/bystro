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
  completeIdokladConnection,
  ConnectionFlowError,
  disconnect,
  enqueueInitialSync,
  requestManualSync,
  startFakturoidConnection,
  startIdokladConnection,
  type FlowDeps,
  type IdokladFlowDeps,
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

function flow(fetchFn: typeof fetch): FlowDeps & { idoklad: null } {
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
    idoklad: null,
  };
}

interface FakeIdoklad {
  /** HTTP status of GET /Account/CurrentAgenda. */
  agendaStatus: number;
  tokenStatus: number;
  requests: { method: string; url: URL; body: string; authorization: string | null }[];
}

/** A stand-in for iDoklad's identity server and the one API endpoint the flow calls. */
function fakeIdoklad(overrides: Partial<FakeIdoklad> = {}) {
  const state: FakeIdoklad = { agendaStatus: 200, tokenStatus: 200, requests: [], ...overrides };
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    state.requests.push({
      method: init?.method ?? "GET",
      url,
      body: String(init?.body ?? ""),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    if (url.pathname.endsWith("/connect/token")) {
      return state.tokenStatus === 200
        ? Response.json({
            access_token: "idoklad-access-plain",
            token_type: "Bearer",
            expires_in: 6000,
            refresh_token: "idoklad-refresh-plain",
          })
        : Response.json({ error: "invalid_grant" }, { status: state.tokenStatus });
    }
    if (url.pathname.endsWith("/connect/revocation")) {
      return new Response(null, { status: 200 });
    }
    if (url.pathname.endsWith("/Account/CurrentAgenda")) {
      return state.agendaStatus === 200
        ? Response.json({
            Data: { Id: 4321, Name: "Dvořák Interiéry", Contact: { IdentificationNumber: "1" } },
            ErrorCode: 0,
            IsSuccess: true,
            StatusCode: 200,
          })
        : new Response(null, { status: state.agendaStatus });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { state, fetchFn };
}

function idokladFlow(fetchFn: typeof fetch): IdokladFlowDeps & { fakturoid: null } {
  return {
    db,
    encryptionKey: key,
    appBaseUrl: APP_URL,
    fetch: fetchFn,
    idoklad: { clientId: "idoklad-client-id", clientSecret: new Secret("idoklad-client-secret") },
    fakturoid: null,
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

/** The log-only detail of a failed attempt. */
async function flowDetail(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error instanceof ConnectionFlowError ? error.detail : "other";
  }
  return "none";
}

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

describe("connecting iDoklad", () => {
  async function startedIdoklad(deps: IdokladFlowDeps, who: Awaited<ReturnType<typeof company>>) {
    const url = new URL(
      await startIdokladConnection(deps, {
        organizationId: who.organization.id,
        userId: who.userId,
      }),
    );
    return { url, state: url.searchParams.get("state") as string };
  }

  it("sends the user to iDoklad with scopes, a state and nothing secret", async () => {
    const { fetchFn } = fakeIdoklad();
    const who = await company();
    const { url, state } = await startedIdoklad(idokladFlow(fetchFn), who);

    expect(`${url.origin}${url.pathname}`).toBe(
      "https://identity.idoklad.cz/server/connect/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("idoklad-client-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("idoklad_api offline_access");
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${APP_URL}/api/integrations/idoklad/callback`,
    );
    // No PKCE: iDoklad refuses it for applications with the plain AuthorizationCode flow.
    expect(url.searchParams.has("code_challenge")).toBe(false);
    expect(state.length).toBeGreaterThan(30);
    expect(url.toString()).not.toContain("idoklad-client-secret");
  });

  it("saves the connection with encrypted tokens and the agenda the token belongs to", async () => {
    const { state: idoklad, fetchFn } = fakeIdoklad();
    const deps = idokladFlow(fetchFn);
    const who = await company();
    const { state } = await startedIdoklad(deps, who);

    const { connection, needsAccountChoice } = await completeIdokladConnection(
      deps,
      who,
      callback(state),
    );

    expect(needsAccountChoice).toBe(false);
    expect(connection).toMatchObject({
      provider: "idoklad",
      category: "invoicing",
      status: "connected",
      externalAccountId: "4321",
      displayName: "Dvořák Interiéry",
      scopes: ["idoklad_api", "offline_access"],
    });
    expect(JSON.stringify(connection)).not.toMatch(/idoklad-access-plain|idoklad-refresh-plain/);
    const tokens = await readConnectionTokens(db, who.organization.id, connection.id, key);
    expect(tokens?.accessToken.reveal()).toBe("idoklad-access-plain");
    expect(tokens?.refreshToken?.reveal()).toBe("idoklad-refresh-plain");

    // The code is exchanged with the client secret, server to server, and without a
    // PKCE verifier (iDoklad answers invalid_grant to one).
    const exchange = idoklad.requests.find((request) =>
      request.url.pathname.endsWith("/connect/token"),
    );
    const body = new URLSearchParams(exchange?.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("client_id")).toBe("idoklad-client-id");
    expect(body.get("client_secret")).toBe("idoklad-client-secret");
    expect(body.get("scope")).toBe("idoklad_api offline_access");
    expect(body.has("code_verifier")).toBe(false);
    expect(body.get("redirect_uri")).toBe(`${APP_URL}/api/integrations/idoklad/callback`);
    const agenda = idoklad.requests.find((request) =>
      request.url.pathname.endsWith("/Account/CurrentAgenda"),
    );
    expect(agenda?.authorization).toBe("Bearer idoklad-access-plain");
  });

  it("can be connected next to Fakturoid: each has its own connection", async () => {
    const who = await company();
    const fakturoidDeps = flow(fakeFakturoid().fetchFn);
    const first = await started(fakturoidDeps, who);
    await completeFakturoidConnection(fakturoidDeps, who, callback(first.state));

    const deps = idokladFlow(fakeIdoklad().fetchFn);
    const second = await startedIdoklad(deps, who);
    await completeIdokladConnection(deps, who, callback(second.state));

    const connections = await listConnections(db, who.organization.id);
    expect(connections.map((connection) => connection.provider).sort()).toEqual([
      "fakturoid",
      "idoklad",
    ]);
    expect(connections.every((connection) => connection.status === "connected")).toBe(true);
  });

  it("refuses a state from Fakturoid's flow, someone else's or an already used one", async () => {
    const deps = idokladFlow(fakeIdoklad().fetchFn);
    const who = await company();
    const other = await company("Firma B", "25596641");

    // A request started for Fakturoid cannot be finished at iDoklad's callback.
    const fakturoidState = (await started(flow(fakeFakturoid().fetchFn), who)).state;
    expect(await flowError(completeIdokladConnection(deps, who, callback(fakturoidState)))).toBe(
      "invalid_state",
    );

    const { state } = await startedIdoklad(deps, who);
    expect(await flowError(completeIdokladConnection(deps, other, callback(state)))).toBe(
      "invalid_state",
    );
    expect(await flowError(completeIdokladConnection(deps, who, callback("made-up")))).toBe(
      "invalid_state",
    );
    await completeIdokladConnection(deps, who, callback(state));
    expect(await flowError(completeIdokladConnection(deps, who, callback(state)))).toBe(
      "invalid_state",
    );
    expect(await listConnections(db, other.organization.id)).toHaveLength(0);
  });

  it("stores nothing when the user says no or iDoklad gives no tokens", async () => {
    const who = await company();
    const refusing = idokladFlow(fakeIdoklad({ tokenStatus: 400 }).fetchFn);

    const denied = await startedIdoklad(refusing, who);
    expect(
      await flowError(
        completeIdokladConnection(
          refusing,
          who,
          callback(denied.state, { code: null, error: "access_denied" }),
        ),
      ),
    ).toBe("denied");

    const failed = await startedIdoklad(refusing, who);
    expect(await flowError(completeIdokladConnection(refusing, who, callback(failed.state)))).toBe(
      "provider_unavailable",
    );
    expect(await listConnections(db, who.organization.id)).toHaveLength(0);
  });

  it("says for the log at which step it failed, without any provider text", async () => {
    const who = await company();

    const noTokens = idokladFlow(fakeIdoklad({ tokenStatus: 400 }).fetchFn);
    const first = await startedIdoklad(noTokens, who);
    expect(await flowDetail(completeIdokladConnection(noTokens, who, callback(first.state)))).toBe(
      "token: 400 invalid_grant",
    );

    const noAgenda = idokladFlow(fakeIdoklad({ agendaStatus: 401 }).fetchFn);
    const second = await startedIdoklad(noAgenda, who);
    expect(await flowDetail(completeIdokladConnection(noAgenda, who, callback(second.state)))).toBe(
      "account: reauth_required",
    );
  });

  it("gives the access back when the plan at iDoklad does not allow the API", async () => {
    for (const [agendaStatus, code] of [
      [402, "account_blocked"],
      [500, "provider_unavailable"],
    ] as const) {
      const { state: idoklad, fetchFn } = fakeIdoklad({ agendaStatus });
      const deps = idokladFlow(fetchFn);
      const who = await company();
      const { state } = await startedIdoklad(deps, who);

      expect(await flowError(completeIdokladConnection(deps, who, callback(state)))).toBe(code);

      expect(await listConnections(db, who.organization.id)).toHaveLength(0);
      const revocation = idoklad.requests.find((request) =>
        request.url.pathname.endsWith("/connect/revocation"),
      );
      expect(new URLSearchParams(revocation?.body).get("token")).toBe("idoklad-refresh-plain");
    }
  });
});

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

  it("revokes the access at iDoklad when an iDoklad connection is disconnected", async () => {
    const { state: idoklad, fetchFn } = fakeIdoklad();
    const deps = idokladFlow(fetchFn);
    const who = await company();
    const url = new URL(
      await startIdokladConnection(deps, {
        organizationId: who.organization.id,
        userId: who.userId,
      }),
    );
    const { connection } = await completeIdokladConnection(
      deps,
      who,
      callback(url.searchParams.get("state")),
    );
    const where = { organizationId: who.organization.id, connectionId: connection.id };
    await upsertInvoices(db, where, [{ ...invoice, source: "idoklad", externalId: "invoice-1" }]);
    idoklad.requests.length = 0;

    expect(await disconnect(deps, { ...where, userId: who.userId })).toBe(true);

    expect(idoklad.requests.map((request) => request.url.pathname)).toEqual([
      "/server/connect/revocation",
    ]);
    expect(Object.fromEntries(new URLSearchParams(idoklad.requests[0]?.body))).toMatchObject({
      token: "idoklad-refresh-plain",
      token_type_hint: "refresh_token",
    });
    expect(
      await readConnectionTokens(db, where.organizationId, where.connectionId, key),
    ).toBeNull();
    expect((await getConnection(db, where.organizationId, where.connectionId))?.status).toBe(
      "revoked",
    );
    expect(await listInvoices(db, where.organizationId)).toHaveLength(0);
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

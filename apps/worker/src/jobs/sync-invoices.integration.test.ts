import { randomBytes } from "node:crypto";

import {
  ProviderError,
  Secret,
  type Invoice,
  type InvoiceProvider,
  type RateLimitDecision,
  type SyncInvoicesPayload,
} from "@bystro/core";
import {
  applyConnectionEvent,
  createDb,
  disconnectConnection,
  forOrganization,
  getConnection,
  listInvoices,
  readConnectionTokens,
  saveConnection,
  type ConnectionTokens,
} from "@bystro/db";
import { createTestOrganization, loadRootEnv, readTestDatabase } from "@bystro/db/testing";
import type { OAuthProviderConfig } from "@bystro/integrations";
import { UnrecoverableError } from "bullmq";
import { afterAll, describe, expect, it } from "vitest";

import { RateLimitedError, type RateLimiter } from "../rate-limiter";
import { silentLogger } from "../test/redis";
import { dispatchInvoiceSyncHandler } from "./dispatch-invoice-sync";
import { syncInvoicesHandler, type InvoiceProviderSetup } from "./sync-invoices";

loadRootEnv();
const { db, close } = createDb(readTestDatabase().url);
const key = randomBytes(32);
const NOW = new Date("2026-10-11T08:00:00Z");
const SOURCE = "testprovider";
const system = { actor: { type: "system" as const }, source: "worker" as const };

afterAll(async () => {
  await close();
});

const invoice = (externalId: string): Invoice => ({
  source: SOURCE,
  externalId,
  sourceUpdatedAt: null,
  number: `2026-${externalId}`,
  variableSymbol: null,
  kind: "invoice",
  direction: "issued",
  sourceStatus: "open",
  clientExternalId: null,
  issuedOn: "2026-09-20",
  taxableSupplyOn: null,
  dueOn: "2026-10-04",
  paidOn: null,
  currency: "CZK",
  subtotalMinor: 100_000n,
  vatMinor: 21_000n,
  totalMinor: 121_000n,
  lines: [],
  payments: [],
});

/** A provider that returns two invoices, or fails the way a test asks. */
function fakeProvider(fail?: () => Error): InvoiceProvider {
  const attempt = () => {
    const error = fail?.();
    if (error !== undefined) throw error;
  };
  return {
    source: SOURCE,
    async listInvoices() {
      attempt();
      return { items: [invoice("1"), invoice("2")], nextCursor: null };
    },
    async getInvoice() {
      return null;
    },
    async listClients() {
      attempt();
      return { items: [], nextCursor: null };
    },
    async listPayments() {
      return { items: [], nextCursor: null };
    },
    async getDocument() {
      return null;
    },
  };
}

const openLimiter: RateLimiter = {
  acquire: async (): Promise<RateLimitDecision> => ({ allowed: true, retryAfterMs: 0 }),
  require: async () => {},
};

const oauth: OAuthProviderConfig = {
  id: SOURCE,
  authorizationEndpoint: "https://provider.example/oauth",
  tokenEndpoint: "https://provider.example/oauth/token",
  clientId: "client-id",
  clientSecret: new Secret("client-secret"),
  scopes: [],
  pkce: "none",
  clientAuthentication: "basic",
};

async function connected(tokens: Partial<ConnectionTokens> = {}) {
  const { organization, owner } = await createTestOrganization(db, "Firma A");
  const connection = await saveConnection(
    db,
    organization.id,
    {
      provider: SOURCE,
      category: "invoicing",
      externalAccountId: "ucet",
      scopes: [],
      tokens: {
        accessToken: new Secret("access-old"),
        refreshToken: new Secret("refresh-keep"),
        expiresAt: new Date("2026-10-11T12:00:00Z"),
        ...tokens,
      },
      userId: owner.id,
      source: "web",
    },
    key,
  );
  const data: SyncInvoicesPayload = {
    organizationId: organization.id,
    connectionId: connection.id,
    mode: "incremental",
  };
  return { data, organizationId: organization.id, connectionId: connection.id, ownerId: owner.id };
}

interface RunOptions {
  provider?: InvoiceProvider;
  limiter?: RateLimiter;
  setup?: Partial<InvoiceProviderSetup> | null;
  fetch?: typeof fetch;
  now?: Date;
  usedTokens?: ConnectionTokens[];
}

function run(data: SyncInvoicesPayload, options: RunOptions = {}) {
  const handler = syncInvoicesHandler({
    db,
    encryptionKey: key,
    rateLimiter: options.limiter ?? openLimiter,
    now: () => options.now ?? NOW,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    resolveProvider: () =>
      options.setup === null
        ? null
        : {
            oauth,
            rateLimit: { key: "testprovider.ucet", limit: { max: 400, windowMs: 60_000 } },
            create: (tokens) => {
              options.usedTokens?.push(tokens);
              return options.provider ?? fakeProvider();
            },
            ...options.setup,
          },
  });
  return handler({ data, jobId: "job-1", attempt: 1, logger: silentLogger });
}

const statusOf = async (organizationId: string, connectionId: string) =>
  (await getConnection(db, organizationId, connectionId))?.status;

describe("syncInvoicesHandler", () => {
  it("syncs, marks the connection connected and writes an audit record with counts only", async () => {
    const { data, organizationId, connectionId } = await connected();

    await run(data);

    const connection = await getConnection(db, organizationId, connectionId);
    expect(connection).toMatchObject({ status: "connected", lastErrorCode: null });
    expect(connection?.lastSyncAt).toBeInstanceOf(Date);
    expect(await listInvoices(db, organizationId)).toHaveLength(2);

    const audit = await forOrganization(db, organizationId).listAuditLogs();
    const synced = audit.find((entry) => entry.action === "invoices.synced");
    expect(synced).toMatchObject({
      actorType: "system",
      source: "worker",
      result: "success",
      targetType: "integration_connection",
      targetId: connectionId,
      metadata: { provider: SOURCE, mode: "full", invoicesCreated: 2, invoicesDeleted: 0 },
    });
    expect(JSON.stringify(synced?.metadata)).not.toMatch(/121000|access-old|refresh-keep/);
  });

  it("running the job again changes nothing", async () => {
    const { data, organizationId } = await connected();
    await run(data);
    await run(data, { now: new Date("2026-10-11T09:00:00Z") });
    expect(await listInvoices(db, organizationId)).toHaveLength(2);
  });

  it("refreshes an expiring access token and keeps the refresh token it was not given anew", async () => {
    const { data, organizationId, connectionId } = await connected({
      expiresAt: new Date("2026-10-11T08:02:00Z"),
    });
    const requests: { url: string; body: string; authorization: string | null }[] = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        body: String(init?.body),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Response.json({ access_token: "access-new", token_type: "Bearer", expires_in: 7200 });
    }) as typeof fetch;
    const usedTokens: ConnectionTokens[] = [];

    await run(data, { fetch: fetchFn, usedTokens });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(oauth.tokenEndpoint);
    expect(requests[0]?.body).toContain("grant_type=refresh_token");
    expect(usedTokens[0]?.accessToken.reveal()).toBe("access-new");
    const stored = await readConnectionTokens(db, organizationId, connectionId, key);
    expect(stored?.accessToken.reveal()).toBe("access-new");
    expect(stored?.refreshToken?.reveal()).toBe("refresh-keep");
    expect(stored?.expiresAt).toEqual(new Date("2026-10-11T10:00:00Z"));
    expect(await statusOf(organizationId, connectionId)).toBe("connected");
  });

  it("asks the user to reconnect when the provider rejects the refresh token", async () => {
    const { data, organizationId, connectionId } = await connected({
      expiresAt: new Date("2026-10-11T07:00:00Z"),
    });
    const fetchFn = (async () =>
      Response.json({ error: "invalid_grant" }, { status: 400 })) as typeof fetch;

    await expect(run(data, { fetch: fetchFn })).rejects.toMatchObject({ code: "reauth_required" });
    expect(await getConnection(db, organizationId, connectionId)).toMatchObject({
      status: "reauth_required",
      lastErrorCode: "reauth_required",
    });
    expect(await listInvoices(db, organizationId)).toHaveLength(0);
  });

  it("401 from the provider needs a new authorization and is not retried", async () => {
    const { data, organizationId, connectionId } = await connected();
    const failure = run(data, {
      provider: fakeProvider(() => new ProviderError("reauth_required")),
    });

    await expect(failure).rejects.toBeInstanceOf(UnrecoverableError);
    expect(await statusOf(organizationId, connectionId)).toBe("reauth_required");

    // Later runs leave the connection alone until the user reconnects.
    await run(data);
    expect(await statusOf(organizationId, connectionId)).toBe("reauth_required");
    expect(await listInvoices(db, organizationId)).toHaveLength(0);
  });

  it("a rate limit from the provider postpones the job and the next run succeeds", async () => {
    const { data, organizationId, connectionId } = await connected();
    const limited = run(data, {
      provider: fakeProvider(() => new ProviderError("rate_limited", 55_000)),
    });

    await expect(limited).rejects.toBeInstanceOf(RateLimitedError);
    await expect(limited).rejects.toMatchObject({ retryAfterMs: 55_000 });
    expect(await getConnection(db, organizationId, connectionId)).toMatchObject({
      status: "degraded",
      lastErrorCode: "rate_limited",
    });

    await run(data);
    expect(await statusOf(organizationId, connectionId)).toBe("connected");
    expect(await listInvoices(db, organizationId)).toHaveLength(2);
  });

  it("our own limiter stops the sync before the provider is asked", async () => {
    const { data, organizationId, connectionId } = await connected();
    let asked = 0;
    const closedLimiter: RateLimiter = {
      acquire: async () => ({ allowed: false, retryAfterMs: 12_000 }),
      require: async () => {
        throw new RateLimitedError(12_000);
      },
    };

    await expect(
      run(data, {
        limiter: closedLimiter,
        provider: fakeProvider(() => {
          asked += 1;
          return new Error("must not be reached");
        }),
      }),
    ).rejects.toMatchObject({ retryAfterMs: 12_000 });
    expect(asked).toBe(0);
    expect(await statusOf(organizationId, connectionId)).toBe("degraded");
  });

  it("an outage is worth retrying; a broken response is not", async () => {
    const outage = await connected();
    await expect(
      run(outage.data, { provider: fakeProvider(() => new ProviderError("provider_unavailable")) }),
    ).rejects.toMatchObject({ code: "provider_unavailable", retryable: true });
    expect(await statusOf(outage.organizationId, outage.connectionId)).toBe("degraded");

    const broken = await connected();
    const failure = run(broken.data, {
      provider: fakeProvider(() => new ProviderError("invalid_response")),
    });
    await expect(failure).rejects.toBeInstanceOf(UnrecoverableError);
    expect(await getConnection(db, broken.organizationId, broken.connectionId)).toMatchObject({
      status: "error",
      lastErrorCode: "invalid_response",
    });
  });

  it("an unexpected error marks the connection failed with a code, not the message", async () => {
    const { data, organizationId, connectionId } = await connected();
    await expect(
      run(data, { provider: fakeProvider(() => new TypeError("secret detail 121000")) }),
    ).rejects.toThrow(TypeError);
    expect(await getConnection(db, organizationId, connectionId)).toMatchObject({
      status: "error",
      lastErrorCode: "TypeError",
    });
  });

  it("does not run next to a sync in progress, but takes over one that was interrupted", async () => {
    const { data, organizationId, connectionId } = await connected();
    await applyConnectionEvent(db, organizationId, connectionId, "sync_started", system);

    // Started a moment ago: someone else is on it.
    await run(data, { now: new Date() });
    expect(await statusOf(organizationId, connectionId)).toBe("syncing");
    expect(await listInvoices(db, organizationId)).toHaveLength(0);

    // Marked as running for an hour: the worker died mid-sync.
    await run(data, { now: new Date(Date.now() + 60 * 60 * 1000) });
    expect(await statusOf(organizationId, connectionId)).toBe("connected");
    expect(await listInvoices(db, organizationId)).toHaveLength(2);
  });

  it("fails for good without touching the status when it cannot even start", async () => {
    const unconfigured = await connected();
    await expect(run(unconfigured.data, { setup: null })).rejects.toMatchObject({
      code: "provider_not_configured",
    });
    expect(await statusOf(unconfigured.organizationId, unconfigured.connectionId)).toBe(
      "connected",
    );

    const other = await connected();
    await expect(
      run({ ...unconfigured.data, organizationId: other.organizationId }),
    ).rejects.toMatchObject({ code: "connection_not_found" });
  });

  it("skips a disconnected connection", async () => {
    const { data, organizationId, connectionId, ownerId } = await connected();
    await disconnectConnection(db, organizationId, connectionId, {
      userId: ownerId,
      source: "web",
    });
    await run(data);
    expect(await statusOf(organizationId, connectionId)).toBe("revoked");
    expect(await listInvoices(db, organizationId)).toHaveLength(0);
  });
});

describe("dispatchInvoiceSyncHandler", () => {
  it("enqueues one sync per connection with an id that is stable within the hour", async () => {
    const targets = [
      {
        organizationId: "0b0e8a52-5f0c-4d6e-9d57-0e6f0a5f3c11",
        connectionId: "5b1f6a0e-93f4-4e63-8a3b-0e1b7a5d2c44",
        provider: "fakturoid",
      },
      {
        organizationId: "9c2d7b61-0a1e-4f5b-b8a7-3d2c1e0f9a88",
        connectionId: "7e3a9c10-2b4d-4c6f-9e8a-1f0b2c3d4e55",
        provider: "fakturoid",
      },
    ];
    const enqueued: { data: SyncInvoicesPayload; jobId: string }[] = [];
    const handler = dispatchInvoiceSyncHandler({
      listTargets: async () => targets,
      enqueue: async (data, jobId) => {
        enqueued.push({ data, jobId });
        return true;
      },
      now: () => new Date("2026-10-11T08:00:03Z"),
    });

    await handler({
      data: { mode: "incremental" },
      jobId: "d-1",
      attempt: 1,
      logger: silentLogger,
    });

    expect(enqueued).toEqual([
      {
        data: {
          organizationId: targets[0]?.organizationId,
          connectionId: targets[0]?.connectionId,
          mode: "incremental",
        },
        jobId: "sync.invoices.5b1f6a0e-93f4-4e63-8a3b-0e1b7a5d2c44.incremental.2026-10-11T08",
      },
      {
        data: {
          organizationId: targets[1]?.organizationId,
          connectionId: targets[1]?.connectionId,
          mode: "incremental",
        },
        jobId: "sync.invoices.7e3a9c10-2b4d-4c6f-9e8a-1f0b2c3d4e55.incremental.2026-10-11T08",
      },
    ]);
  });
});

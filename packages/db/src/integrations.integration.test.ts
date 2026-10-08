import { randomBytes, randomUUID } from "node:crypto";

import { IntegrationTransitionError, Secret } from "@bystro/core";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { createDb } from "./client";
import { DecryptionError } from "./crypto";
import {
  applyConnectionEvent,
  ConnectionNotFoundError,
  consumeOAuthRequest,
  createOAuthRequest,
  deleteExpiredOAuthRequests,
  disconnectConnection,
  findOAuthRequest,
  getConnection,
  getSyncCursor,
  listConnections,
  markWebhookEventProcessed,
  readConnectionTokens,
  recordWebhookEvent,
  saveConnection,
  setSyncCursor,
  updateConnectionTokens,
} from "./integrations";
import {
  integrationConnections,
  integrationCredentials,
  oauthRequests,
  webhookEvents,
} from "./schema";
import { forOrganization } from "./tenant";
import { createTestOrganization, expectPgError, PG_UNIQUE_VIOLATION } from "./test/fixtures";
import { readTestDatabase } from "./test/test-database";

const { db, close } = createDb(readTestDatabase().url);
const key = randomBytes(32);
const otherKey = randomBytes(32);

const ACCESS = "access-token-plaintext-value";
const REFRESH = "refresh-token-plaintext-value";

afterAll(async () => {
  await close();
});

const tokens = (access = ACCESS, refresh: string | null = REFRESH) => ({
  accessToken: new Secret(access),
  refreshToken: refresh === null ? null : new Secret(refresh),
  expiresAt: new Date("2026-10-05T12:00:00Z"),
});

async function connect(name: string, provider = "fakturoid") {
  const { organization, owner } = await createTestOrganization(db, name);
  const connection = await saveConnection(
    db,
    organization.id,
    {
      provider,
      category: "invoicing",
      externalAccountId: "dvorak-interiery",
      displayName: "Dvořák Interiéry",
      scopes: ["invoices:read"],
      tokens: tokens(),
      userId: owner.id,
      source: "web",
    },
    key,
  );
  return { organization, owner, connection };
}

const system = { actor: { type: "system" as const }, source: "worker" as const };

describe("saveConnection", () => {
  it("creates a connected connection with an audit record", async () => {
    const { organization, connection } = await connect("Firma A");

    expect(connection).toMatchObject({
      organizationId: organization.id,
      provider: "fakturoid",
      category: "invoicing",
      status: "connected",
      externalAccountId: "dvorak-interiery",
      displayName: "Dvořák Interiéry",
      scopes: ["invoices:read"],
      lastErrorCode: null,
    });
    const audit = await forOrganization(db, organization.id).listAuditLogs({ limit: 1 });
    expect(audit[0]).toMatchObject({
      action: "integration.connected",
      targetId: connection.id,
      metadata: { provider: "fakturoid", scopes: ["invoices:read"], previousStatus: null },
    });
  });

  it("stores tokens encrypted: the database never holds the plaintext", async () => {
    const { connection } = await connect("Firma A");

    const [row] = await db
      .select()
      .from(integrationCredentials)
      .where(eq(integrationCredentials.connectionId, connection.id));
    const stored = JSON.stringify(row);

    expect(stored).not.toContain(ACCESS);
    expect(stored).not.toContain(REFRESH);
    expect(row?.accessTokenEncrypted).toMatch(/^v1\./);
    expect(row?.refreshTokenEncrypted).toMatch(/^v1\./);
  });

  it("never puts tokens into the connection row or the audit log", async () => {
    const { organization, connection } = await connect("Firma A");

    const audit = await forOrganization(db, organization.id).listAuditLogs();
    for (const text of [JSON.stringify(connection), JSON.stringify(audit)]) {
      expect(text).not.toContain(ACCESS);
      expect(text).not.toContain(REFRESH);
    }
  });

  it("reconnecting reuses the connection, replaces the tokens and clears the error", async () => {
    const { organization, owner, connection } = await connect("Firma A");
    await applyConnectionEvent(db, organization.id, connection.id, "auth_failed", {
      ...system,
      errorCode: "http_401",
    });

    const reconnected = await saveConnection(
      db,
      organization.id,
      {
        provider: "fakturoid",
        category: "invoicing",
        scopes: ["invoices:read", "clients:read"],
        tokens: tokens("new-access-token", null),
        userId: owner.id,
        source: "web",
      },
      key,
    );

    expect(reconnected.id).toBe(connection.id);
    expect(reconnected).toMatchObject({
      status: "connected",
      scopes: ["invoices:read", "clients:read"],
      lastErrorCode: null,
      lastErrorAt: null,
    });
    expect(await listConnections(db, organization.id)).toHaveLength(1);

    const stored = await readConnectionTokens(db, organization.id, connection.id, key);
    expect(stored?.accessToken.reveal()).toBe("new-access-token");
    expect(stored?.refreshToken).toBeNull();

    const audit = await forOrganization(db, organization.id).listAuditLogs({ limit: 1 });
    expect(audit[0]).toMatchObject({
      action: "integration.reconnected",
      metadata: { previousStatus: "reauth_required" },
    });
  });

  it("allows one connection per provider per organization", async () => {
    const { organization, owner } = await connect("Firma A");
    await expectPgError(
      db.insert(integrationConnections).values({
        organizationId: organization.id,
        provider: "fakturoid",
        category: "invoicing",
        status: "connected",
        createdByUserId: owner.id,
      }),
      PG_UNIQUE_VIOLATION,
    );
  });
});

describe("tenant isolation of connections", () => {
  it("organization B cannot see, read tokens of, change or disconnect A's connection", async () => {
    const a = await connect("Firma A");
    const b = await connect("Firma B");

    expect((await listConnections(db, a.organization.id)).map((c) => c.id)).toEqual([
      a.connection.id,
    ]);
    expect((await listConnections(db, b.organization.id)).map((c) => c.id)).toEqual([
      b.connection.id,
    ]);

    // Using B's organization with A's connection id:
    const orgB = b.organization.id;
    const connectionA = a.connection.id;
    expect(await getConnection(db, orgB, connectionA)).toBeNull();
    expect(await readConnectionTokens(db, orgB, connectionA, key)).toBeNull();
    expect(await getSyncCursor(db, orgB, connectionA, "invoices")).toBeNull();
    await expect(
      applyConnectionEvent(db, orgB, connectionA, "sync_started", system),
    ).rejects.toThrow(ConnectionNotFoundError);
    await expect(
      disconnectConnection(db, orgB, connectionA, { userId: b.owner.id, source: "web" }),
    ).rejects.toThrow(ConnectionNotFoundError);
    await expect(updateConnectionTokens(db, orgB, connectionA, tokens("x"), key)).rejects.toThrow(
      ConnectionNotFoundError,
    );
    await expect(setSyncCursor(db, orgB, connectionA, "invoices", "x")).rejects.toThrow(
      ConnectionNotFoundError,
    );
    await expect(
      recordWebhookEvent(db, orgB, { connectionId: connectionA, externalId: "evt-1" }),
    ).rejects.toThrow(ConnectionNotFoundError);

    // A's connection is untouched.
    expect((await getConnection(db, a.organization.id, connectionA))?.status).toBe("connected");
    expect(
      (await readConnectionTokens(db, a.organization.id, connectionA, key))?.accessToken.reveal(),
    ).toBe(ACCESS);
  });
});

describe("credentials", () => {
  it("decrypts tokens only with the right key and returns them wrapped", async () => {
    const { organization, connection } = await connect("Firma A");

    const stored = await readConnectionTokens(db, organization.id, connection.id, key);
    expect(stored?.accessToken.reveal()).toBe(ACCESS);
    expect(stored?.refreshToken?.reveal()).toBe(REFRESH);
    expect(stored?.expiresAt).toEqual(new Date("2026-10-05T12:00:00Z"));
    expect(JSON.stringify(stored)).not.toMatch(/plaintext-value/);

    await expect(
      readConnectionTokens(db, organization.id, connection.id, otherKey),
    ).rejects.toThrow(DecryptionError);
  });

  it("replaces tokens after a refresh", async () => {
    const { organization, connection } = await connect("Firma A");

    await updateConnectionTokens(
      db,
      organization.id,
      connection.id,
      tokens("refreshed-access", "rotated-refresh"),
      key,
    );

    const stored = await readConnectionTokens(db, organization.id, connection.id, key);
    expect(stored?.accessToken.reveal()).toBe("refreshed-access");
    expect(stored?.refreshToken?.reveal()).toBe("rotated-refresh");
  });
});

describe("applyConnectionEvent", () => {
  it("walks a successful sync and records times and audit", async () => {
    const { organization, connection } = await connect("Firma A");

    const syncing = await applyConnectionEvent(
      db,
      organization.id,
      connection.id,
      "sync_started",
      system,
    );
    expect(syncing.status).toBe("syncing");
    expect(syncing.lastSyncStartedAt).toBeInstanceOf(Date);
    expect(syncing.lastSyncAt).toBeNull();

    const done = await applyConnectionEvent(
      db,
      organization.id,
      connection.id,
      "sync_succeeded",
      system,
    );
    expect(done.status).toBe("connected");
    expect(done.lastSyncAt).toBeInstanceOf(Date);

    const audit = await forOrganization(db, organization.id).listAuditLogs({ limit: 2 });
    expect(audit.map((log) => log.metadata)).toEqual([
      { provider: "fakturoid", event: "sync_succeeded", from: "syncing", to: "connected" },
      { provider: "fakturoid", event: "sync_started", from: "connected", to: "syncing" },
    ]);
    expect(audit.every((log) => log.actorType === "system" && log.source === "worker")).toBe(true);
  });

  it("stores an error code on failure and clears it after the next success", async () => {
    const { organization, connection } = await connect("Firma A");
    const apply = (event: Parameters<typeof applyConnectionEvent>[3], errorCode?: string) =>
      applyConnectionEvent(db, organization.id, connection.id, event, {
        ...system,
        ...(errorCode === undefined ? {} : { errorCode }),
      });

    await apply("sync_started");
    const degraded = await apply("sync_degraded", "rate_limited");
    expect(degraded).toMatchObject({ status: "degraded", lastErrorCode: "rate_limited" });
    expect(degraded.lastErrorAt).toBeInstanceOf(Date);

    await apply("sync_started");
    const recovered = await apply("sync_succeeded");
    expect(recovered).toMatchObject({
      status: "connected",
      lastErrorCode: null,
      lastErrorAt: null,
    });

    const audit = await forOrganization(db, organization.id).listAuditLogs({ limit: 3 });
    expect(audit[2]).toMatchObject({ result: "failure", metadata: { errorCode: "rate_limited" } });
  });

  it("rejects an event that is not allowed and changes nothing", async () => {
    const { organization, connection } = await connect("Firma A");
    const auditBefore = (await forOrganization(db, organization.id).listAuditLogs()).length;

    await expect(
      applyConnectionEvent(db, organization.id, connection.id, "sync_succeeded", system),
    ).rejects.toThrow(IntegrationTransitionError);

    expect((await getConnection(db, organization.id, connection.id))?.status).toBe("connected");
    expect(await forOrganization(db, organization.id).listAuditLogs()).toHaveLength(auditBefore);
  });

  it("lets only one of several concurrent sync starts through", async () => {
    const { organization, connection } = await connect("Firma A");

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        applyConnectionEvent(db, organization.id, connection.id, "sync_started", system),
      ),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(4);
    for (const result of rejected) {
      expect(result.reason).toBeInstanceOf(IntegrationTransitionError);
    }
  });
});

describe("disconnectConnection", () => {
  it("revokes the connection, deletes its tokens and writes an audit record", async () => {
    const { organization, owner, connection } = await connect("Firma A");

    const revoked = await disconnectConnection(db, organization.id, connection.id, {
      userId: owner.id,
      source: "web",
    });

    expect(revoked.status).toBe("revoked");
    expect(await readConnectionTokens(db, organization.id, connection.id, key)).toBeNull();
    expect(
      await db
        .select()
        .from(integrationCredentials)
        .where(eq(integrationCredentials.connectionId, connection.id)),
    ).toEqual([]);
    const audit = await forOrganization(db, organization.id).listAuditLogs({ limit: 1 });
    expect(audit[0]).toMatchObject({
      action: "integration.disconnected",
      actorUserId: owner.id,
      metadata: { provider: "fakturoid", previousStatus: "connected" },
    });
  });

  it("a revoked connection cannot sync and cannot be revoked twice", async () => {
    const { organization, owner, connection } = await connect("Firma A");
    const context = { userId: owner.id, source: "web" as const };
    await disconnectConnection(db, organization.id, connection.id, context);

    await expect(
      applyConnectionEvent(db, organization.id, connection.id, "sync_started", system),
    ).rejects.toThrow(IntegrationTransitionError);
    await expect(disconnectConnection(db, organization.id, connection.id, context)).rejects.toThrow(
      IntegrationTransitionError,
    );
  });
});

describe("OAuth requests", () => {
  const newRequest = (userId: string, verifier: string | null = "pkce-verifier-plaintext") => ({
    userId,
    provider: "fakturoid",
    stateHash: randomBytes(32).toString("hex"),
    codeVerifier: verifier === null ? null : new Secret(verifier),
    redirectUri: "http://localhost:3000/api/integrations/fakturoid/callback",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  it("stores the request with an encrypted PKCE verifier and finds it by state hash", async () => {
    const { organization, owner } = await createTestOrganization(db, "Firma A");
    const request = newRequest(owner.id);
    await createOAuthRequest(db, organization.id, request, key);

    const [row] = await db
      .select()
      .from(oauthRequests)
      .where(eq(oauthRequests.stateHash, request.stateHash));
    expect(JSON.stringify(row)).not.toContain("pkce-verifier-plaintext");
    expect(row?.codeVerifierEncrypted).toMatch(/^v1\./);

    const found = await findOAuthRequest(
      db,
      organization.id,
      { stateHash: request.stateHash, userId: owner.id },
      key,
    );
    expect(found).toMatchObject({
      provider: "fakturoid",
      stateHash: request.stateHash,
      redirectUri: request.redirectUri,
      consumedAt: null,
    });
    expect(found?.codeVerifier?.reveal()).toBe("pkce-verifier-plaintext");
    expect(JSON.stringify(found)).not.toContain("pkce-verifier-plaintext");
  });

  it("is invisible to another user, another organization and an unknown state", async () => {
    const a = await createTestOrganization(db, "Firma A");
    const b = await createTestOrganization(db, "Firma B");
    const request = newRequest(a.owner.id, null);
    await createOAuthRequest(db, a.organization.id, request, key);
    const find = (organizationId: string, userId: string, stateHash = request.stateHash) =>
      findOAuthRequest(db, organizationId, { stateHash, userId }, key);

    expect((await find(a.organization.id, a.owner.id))?.codeVerifier).toBeNull();
    expect(await find(b.organization.id, b.owner.id)).toBeNull();
    expect(await find(a.organization.id, b.owner.id)).toBeNull();
    expect(await find(b.organization.id, a.owner.id)).toBeNull();
    expect(await find(a.organization.id, a.owner.id, "0".repeat(64))).toBeNull();
  });

  it("can be consumed exactly once, also under concurrency", async () => {
    const { organization, owner } = await createTestOrganization(db, "Firma A");
    const request = newRequest(owner.id);
    await createOAuthRequest(db, organization.id, request, key);
    const found = await findOAuthRequest(
      db,
      organization.id,
      { stateHash: request.stateHash, userId: owner.id },
      key,
    );
    const id = found?.id as string;

    const results = await Promise.all(
      Array.from({ length: 5 }, () => consumeOAuthRequest(db, organization.id, id)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await consumeOAuthRequest(db, organization.id, id)).toBe(false);

    const after = await findOAuthRequest(
      db,
      organization.id,
      { stateHash: request.stateHash, userId: owner.id },
      key,
    );
    expect(after?.consumedAt).toBeInstanceOf(Date);
  });

  it("cannot be consumed through another organization", async () => {
    const a = await createTestOrganization(db, "Firma A");
    const b = await createTestOrganization(db, "Firma B");
    const request = newRequest(a.owner.id);
    await createOAuthRequest(db, a.organization.id, request, key);
    const found = await findOAuthRequest(
      db,
      a.organization.id,
      { stateHash: request.stateHash, userId: a.owner.id },
      key,
    );

    expect(await consumeOAuthRequest(db, b.organization.id, found?.id as string)).toBe(false);
    expect(await consumeOAuthRequest(db, a.organization.id, found?.id as string)).toBe(true);
  });

  it("rejects a duplicate state", async () => {
    const { organization, owner } = await createTestOrganization(db, "Firma A");
    const request = newRequest(owner.id);
    await createOAuthRequest(db, organization.id, request, key);
    await expectPgError(createOAuthRequest(db, organization.id, request, key), PG_UNIQUE_VIOLATION);
  });
});

describe("sync cursors", () => {
  it("returns null before the first sync and the latest position afterwards", async () => {
    const { organization, connection } = await connect("Firma A");
    const cursor = (resource: string) =>
      getSyncCursor(db, organization.id, connection.id, resource);

    expect(await cursor("invoices")).toBeNull();

    await setSyncCursor(db, organization.id, connection.id, "invoices", "2026-10-01T00:00:00Z");
    await setSyncCursor(db, organization.id, connection.id, "invoices", "2026-10-05T00:00:00Z");
    await setSyncCursor(db, organization.id, connection.id, "clients", "page-3");

    expect(await cursor("invoices")).toBe("2026-10-05T00:00:00Z");
    expect(await cursor("clients")).toBe("page-3");
  });
});

describe("webhook events", () => {
  it("accepts an event once; repeated and concurrent deliveries are reported as duplicates", async () => {
    const { organization, connection } = await connect("Firma A");
    const externalId = `evt-${randomUUID()}`;
    const record = () =>
      recordWebhookEvent(db, organization.id, { connectionId: connection.id, externalId });

    expect(await record()).toBe(true);
    expect(await record()).toBe(false);
    expect((await Promise.all([record(), record(), record()])).filter(Boolean)).toHaveLength(0);

    const rows = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.externalId, externalId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: organization.id,
      source: "fakturoid",
      processedAt: null,
    });

    await markWebhookEventProcessed(db, organization.id, { source: "fakturoid", externalId });
    const [processed] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.externalId, externalId));
    expect(processed?.processedAt).toBeInstanceOf(Date);
  });

  it("the same provider event id in two organizations is two different events", async () => {
    const a = await connect("Firma A");
    const b = await connect("Firma B");
    const externalId = `evt-${randomUUID()}`;

    expect(
      await recordWebhookEvent(db, a.organization.id, {
        connectionId: a.connection.id,
        externalId,
      }),
    ).toBe(true);
    expect(
      await recordWebhookEvent(db, b.organization.id, {
        connectionId: b.connection.id,
        externalId,
      }),
    ).toBe(true);
  });
});

describe("deleteExpiredOAuthRequests", () => {
  // Other test files share this database, so the cut-off lies far in the past: only the
  // rows created here can be older than it.
  const cutOff = new Date("2001-06-01T00:00:00Z");
  const request = (userId: string, expiresAt: Date) => ({
    userId,
    provider: "fakturoid",
    stateHash: randomBytes(32).toString("hex"),
    codeVerifier: null,
    redirectUri: "http://localhost:3000/api/integrations/fakturoid/callback",
    expiresAt,
  });
  const exists = async (stateHash: string) =>
    (await db.select().from(oauthRequests).where(eq(oauthRequests.stateHash, stateHash))).length ===
    1;

  it("removes requests that expired before the cut-off, used or not, and nothing else", async () => {
    const a = await createTestOrganization(db, "Firma A");
    const b = await createTestOrganization(db, "Firma B");
    const oldUnused = request(a.owner.id, new Date("2001-01-01T00:00:00Z"));
    const oldUsed = request(b.owner.id, new Date("2001-02-01T00:00:00Z"));
    const afterCutOff = request(a.owner.id, new Date("2001-06-02T00:00:00Z"));
    const live = request(b.owner.id, new Date(Date.now() + 10 * 60 * 1000));
    await createOAuthRequest(db, a.organization.id, oldUnused, key);
    await createOAuthRequest(db, b.organization.id, oldUsed, key);
    await createOAuthRequest(db, a.organization.id, afterCutOff, key);
    await createOAuthRequest(db, b.organization.id, live, key);
    const used = await findOAuthRequest(
      db,
      b.organization.id,
      { stateHash: live.stateHash, userId: b.owner.id },
      key,
    );
    expect(used).not.toBeNull();

    expect(await deleteExpiredOAuthRequests(db, cutOff)).toBe(2);

    expect(await exists(oldUnused.stateHash)).toBe(false);
    expect(await exists(oldUsed.stateHash)).toBe(false);
    expect(await exists(afterCutOff.stateHash)).toBe(true);
    expect(await exists(live.stateHash)).toBe(true);
  });

  it("does nothing when run again", async () => {
    expect(await deleteExpiredOAuthRequests(db, cutOff)).toBe(0);
  });
});

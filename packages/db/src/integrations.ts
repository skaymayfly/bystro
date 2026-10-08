import {
  Secret,
  transitionIntegration,
  type AuditSource,
  type IntegrationCategory,
  type IntegrationEvent,
} from "@bystro/core";
import { and, asc, eq, isNull, lt } from "drizzle-orm";

import { writeAudit, type AuditActor } from "./audit";
import type { Db, DbExecutor } from "./client";
import { decrypt, encrypt } from "./crypto";
import { requireUuid } from "./ids";
import {
  integrationConnections,
  integrationCredentials,
  oauthRequests,
  syncCursors,
  webhookEvents,
} from "./schema";

/**
 * Data access for connections to external systems. Every function takes the
 * `organizationId` and filters by it; tokens exist in memory only as {@link Secret}.
 */

export type IntegrationConnection = typeof integrationConnections.$inferSelect;

/** Thrown when a connection does not exist in the given organization. */
export class ConnectionNotFoundError extends Error {
  override name = "ConnectionNotFoundError";
}

export interface ConnectionTokens {
  accessToken: Secret;
  refreshToken: Secret | null;
  expiresAt: Date | null;
}

const encryptSecret = (secret: Secret, key: Buffer) => encrypt(secret.reveal(), key);

// ---------------------------------------------------------------------------------------
// OAuth requests
// ---------------------------------------------------------------------------------------

export interface NewOAuthRequest {
  userId: string;
  provider: string;
  stateHash: string;
  codeVerifier: Secret | null;
  redirectUri: string;
  expiresAt: Date;
}

export interface OAuthRequestRecord {
  id: string;
  userId: string;
  provider: string;
  stateHash: string;
  codeVerifier: Secret | null;
  redirectUri: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

/** Remembers a started authorization until the user returns from the provider. */
export async function createOAuthRequest(
  db: Db,
  organizationId: string,
  request: NewOAuthRequest,
  encryptionKey: Buffer,
): Promise<void> {
  await db.insert(oauthRequests).values({
    organizationId: requireUuid(organizationId, "organizationId"),
    userId: requireUuid(request.userId, "userId"),
    provider: request.provider,
    stateHash: request.stateHash,
    codeVerifierEncrypted:
      request.codeVerifier === null ? null : encryptSecret(request.codeVerifier, encryptionKey),
    redirectUri: request.redirectUri,
    expiresAt: request.expiresAt,
  });
}

/**
 * Finds the authorization started by this user in this organization. A state that belongs
 * to another user or organization is treated as unknown.
 */
export async function findOAuthRequest(
  db: Db,
  organizationId: string,
  lookup: { stateHash: string; userId: string },
  encryptionKey: Buffer,
): Promise<OAuthRequestRecord | null> {
  const [row] = await db
    .select()
    .from(oauthRequests)
    .where(
      and(
        eq(oauthRequests.organizationId, requireUuid(organizationId, "organizationId")),
        eq(oauthRequests.userId, requireUuid(lookup.userId, "userId")),
        eq(oauthRequests.stateHash, lookup.stateHash),
      ),
    );
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    stateHash: row.stateHash,
    codeVerifier:
      row.codeVerifierEncrypted === null
        ? null
        : new Secret(decrypt(row.codeVerifierEncrypted, encryptionKey)),
    redirectUri: row.redirectUri,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
  };
}

/**
 * Marks the request as used. Returns `false` if it was already used: of two concurrent
 * callbacks with the same state exactly one gets `true` and may exchange the code.
 */
export async function consumeOAuthRequest(
  db: Db,
  organizationId: string,
  requestId: string,
): Promise<boolean> {
  const consumed = await db
    .update(oauthRequests)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(oauthRequests.organizationId, requireUuid(organizationId, "organizationId")),
        eq(oauthRequests.id, requireUuid(requestId, "requestId")),
        isNull(oauthRequests.consumedAt),
      ),
    )
    .returning({ id: oauthRequests.id });
  return consumed.length === 1;
}

/**
 * Deletes OAuth requests that expired before the given moment, used or not, in every
 * organization. Maintenance only: these rows are short-lived technical records (a state
 * hash and an encrypted PKCE verifier), not company data, and an expired one can no longer
 * complete an authorization. Returns how many rows were removed; running it again is a no-op.
 */
export async function deleteExpiredOAuthRequests(db: Db, expiredBefore: Date): Promise<number> {
  const deleted = await db
    .delete(oauthRequests)
    .where(lt(oauthRequests.expiresAt, expiredBefore))
    .returning({ id: oauthRequests.id });
  return deleted.length;
}

// ---------------------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------------------

export interface SaveConnectionInput {
  provider: string;
  category: IntegrationCategory;
  externalAccountId?: string | null;
  displayName?: string | null;
  scopes: readonly string[];
  tokens: ConnectionTokens;
  userId: string;
  source: AuditSource;
}

async function requireConnection(
  executor: DbExecutor,
  organizationId: string,
  connectionId: string,
  options: { lock?: boolean } = {},
): Promise<IntegrationConnection> {
  const query = executor
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, organizationId),
        eq(integrationConnections.id, requireUuid(connectionId, "connectionId")),
      ),
    );
  const [row] = await (options.lock === true ? query.for("update") : query);
  if (row === undefined) {
    throw new ConnectionNotFoundError("Connection not found in this organization.");
  }
  return row;
}

async function storeCredentials(
  executor: DbExecutor,
  organizationId: string,
  connectionId: string,
  tokens: ConnectionTokens,
  encryptionKey: Buffer,
): Promise<void> {
  const values = {
    accessTokenEncrypted: encryptSecret(tokens.accessToken, encryptionKey),
    refreshTokenEncrypted:
      tokens.refreshToken === null ? null : encryptSecret(tokens.refreshToken, encryptionKey),
    expiresAt: tokens.expiresAt,
  };
  await executor
    .insert(integrationCredentials)
    .values({ connectionId, organizationId, ...values })
    .onConflictDoUpdate({ target: integrationCredentials.connectionId, set: values });
}

/**
 * Stores a successful authorization: creates the connection, or — if this organization
 * already has one for the provider (expired, revoked, being reconnected) — brings it back
 * to `connected` with the new tokens. One transaction, with an audit record.
 */
export async function saveConnection(
  db: Db,
  organizationId: string,
  input: SaveConnectionInput,
  encryptionKey: Buffer,
): Promise<IntegrationConnection> {
  const orgId = requireUuid(organizationId, "organizationId");
  const userId = requireUuid(input.userId, "userId");

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organizationId, orgId),
          eq(integrationConnections.provider, input.provider),
        ),
      )
      .for("update");

    const details = {
      category: input.category,
      status: "connected" as const,
      externalAccountId: input.externalAccountId ?? null,
      displayName: input.displayName ?? null,
      scopes: [...input.scopes],
      lastErrorCode: null,
      lastErrorAt: null,
    };

    const [connection] =
      existing === undefined
        ? await tx
            .insert(integrationConnections)
            .values({
              organizationId: orgId,
              provider: input.provider,
              createdByUserId: userId,
              ...details,
            })
            .returning()
        : await tx
            .update(integrationConnections)
            .set(details)
            .where(eq(integrationConnections.id, existing.id))
            .returning();
    if (connection === undefined) {
      throw new Error("Connection write returned no row.");
    }

    await storeCredentials(tx, orgId, connection.id, input.tokens, encryptionKey);
    await writeAudit(tx, orgId, {
      actor: { type: "user", userId },
      action: existing === undefined ? "integration.connected" : "integration.reconnected",
      target: { type: "integration_connection", id: connection.id },
      source: input.source,
      metadata: {
        provider: input.provider,
        scopes: [...input.scopes],
        previousStatus: existing?.status ?? null,
      },
    });
    return connection;
  });
}

/** Connections of the organization, oldest first. Never includes credentials. */
export async function listConnections(
  db: Db,
  organizationId: string,
): Promise<IntegrationConnection[]> {
  return db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.organizationId, requireUuid(organizationId, "organizationId")))
    .orderBy(asc(integrationConnections.createdAt), asc(integrationConnections.id));
}

/** One connection of the organization, or `null`. Never includes credentials. */
export async function getConnection(
  db: Db,
  organizationId: string,
  connectionId: string,
): Promise<IntegrationConnection | null> {
  const [row] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, requireUuid(organizationId, "organizationId")),
        eq(integrationConnections.id, requireUuid(connectionId, "connectionId")),
      ),
    );
  return row ?? null;
}

/**
 * Applies an event to the connection through the state machine in `@bystro/core`.
 * The row is locked, so concurrent events are applied one after another; an event that is
 * not allowed in the current status throws and changes nothing. Writes an audit record.
 */
export async function applyConnectionEvent(
  db: Db,
  organizationId: string,
  connectionId: string,
  event: IntegrationEvent,
  context: { actor: AuditActor; source: AuditSource; errorCode?: string },
): Promise<IntegrationConnection> {
  const orgId = requireUuid(organizationId, "organizationId");

  return db.transaction(async (tx) => {
    const current = await requireConnection(tx, orgId, connectionId, { lock: true });
    const status = transitionIntegration(current.status, event);
    const now = new Date();
    const failed = event === "sync_degraded" || event === "sync_failed" || event === "auth_failed";

    const [updated] = await tx
      .update(integrationConnections)
      .set({
        status,
        ...(event === "sync_started" ? { lastSyncStartedAt: now } : {}),
        ...(event === "sync_succeeded"
          ? { lastSyncAt: now, lastErrorCode: null, lastErrorAt: null }
          : {}),
        ...(failed ? { lastErrorCode: context.errorCode ?? event, lastErrorAt: now } : {}),
      })
      .where(eq(integrationConnections.id, current.id))
      .returning();
    if (updated === undefined) {
      throw new Error("Connection update returned no row.");
    }

    await writeAudit(tx, orgId, {
      actor: context.actor,
      action: "integration.status_changed",
      target: { type: "integration_connection", id: current.id },
      source: context.source,
      result: failed ? "failure" : "success",
      metadata: {
        provider: current.provider,
        event,
        from: current.status,
        to: status,
        ...(context.errorCode === undefined ? {} : { errorCode: context.errorCode }),
      },
    });
    return updated;
  });
}

/**
 * Disconnects: the connection becomes `revoked` and its tokens are deleted in the same
 * transaction. Revoking the grant at the provider is the caller's job, done first.
 */
export async function disconnectConnection(
  db: Db,
  organizationId: string,
  connectionId: string,
  context: { userId: string; source: AuditSource },
): Promise<IntegrationConnection> {
  const orgId = requireUuid(organizationId, "organizationId");
  const userId = requireUuid(context.userId, "userId");

  return db.transaction(async (tx) => {
    const current = await requireConnection(tx, orgId, connectionId, { lock: true });
    const status = transitionIntegration(current.status, "revoked");

    await tx
      .delete(integrationCredentials)
      .where(eq(integrationCredentials.connectionId, current.id));
    const [updated] = await tx
      .update(integrationConnections)
      .set({ status })
      .where(eq(integrationConnections.id, current.id))
      .returning();
    if (updated === undefined) {
      throw new Error("Connection update returned no row.");
    }

    await writeAudit(tx, orgId, {
      actor: { type: "user", userId },
      action: "integration.disconnected",
      target: { type: "integration_connection", id: current.id },
      source: context.source,
      metadata: { provider: current.provider, previousStatus: current.status },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------------------

/**
 * Decrypts the tokens of a connection for a server-side call to the provider.
 * Returns `null` when there are none (disconnected). Never send the result to a client.
 */
export async function readConnectionTokens(
  db: Db,
  organizationId: string,
  connectionId: string,
  encryptionKey: Buffer,
): Promise<ConnectionTokens | null> {
  const [row] = await db
    .select()
    .from(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.organizationId, requireUuid(organizationId, "organizationId")),
        eq(integrationCredentials.connectionId, requireUuid(connectionId, "connectionId")),
      ),
    );
  if (row === undefined) {
    return null;
  }
  return {
    accessToken: new Secret(decrypt(row.accessTokenEncrypted, encryptionKey)),
    refreshToken:
      row.refreshTokenEncrypted === null
        ? null
        : new Secret(decrypt(row.refreshTokenEncrypted, encryptionKey)),
    expiresAt: row.expiresAt,
  };
}

/** Replaces the tokens after a refresh. The connection must belong to the organization. */
export async function updateConnectionTokens(
  db: Db,
  organizationId: string,
  connectionId: string,
  tokens: ConnectionTokens,
  encryptionKey: Buffer,
): Promise<void> {
  const orgId = requireUuid(organizationId, "organizationId");
  await db.transaction(async (tx) => {
    const connection = await requireConnection(tx, orgId, connectionId, { lock: true });
    await storeCredentials(tx, orgId, connection.id, tokens, encryptionKey);
  });
}

// ---------------------------------------------------------------------------------------
// Sync cursors and webhook events
// ---------------------------------------------------------------------------------------

/** Where the sync of `resource` left off, or `null` before the first sync. */
export async function getSyncCursor(
  db: Db,
  organizationId: string,
  connectionId: string,
  resource: string,
): Promise<string | null> {
  const [row] = await db
    .select({ cursor: syncCursors.cursor })
    .from(syncCursors)
    .where(
      and(
        eq(syncCursors.organizationId, requireUuid(organizationId, "organizationId")),
        eq(syncCursors.connectionId, requireUuid(connectionId, "connectionId")),
        eq(syncCursors.resource, resource),
      ),
    );
  return row?.cursor ?? null;
}

/** Stores the position reached by the sync of `resource`. */
export async function setSyncCursor(
  db: Db,
  organizationId: string,
  connectionId: string,
  resource: string,
  cursor: string,
): Promise<void> {
  const orgId = requireUuid(organizationId, "organizationId");
  await db.transaction(async (tx) => {
    const connection = await requireConnection(tx, orgId, connectionId);
    await tx
      .insert(syncCursors)
      .values({ organizationId: orgId, connectionId: connection.id, resource, cursor })
      .onConflictDoUpdate({
        target: [syncCursors.connectionId, syncCursors.resource],
        set: { cursor },
      });
  });
}

/**
 * Records a webhook delivery. Returns `true` the first time and `false` for a repeated
 * delivery of the same event, which the caller must then skip.
 */
export async function recordWebhookEvent(
  db: Db,
  organizationId: string,
  event: { connectionId: string; externalId: string },
): Promise<boolean> {
  const orgId = requireUuid(organizationId, "organizationId");
  return db.transaction(async (tx) => {
    const connection = await requireConnection(tx, orgId, event.connectionId);
    const inserted = await tx
      .insert(webhookEvents)
      .values({
        organizationId: orgId,
        connectionId: connection.id,
        source: connection.provider,
        externalId: event.externalId,
      })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    return inserted.length === 1;
  });
}

/** Marks a recorded webhook delivery as handled. */
export async function markWebhookEventProcessed(
  db: Db,
  organizationId: string,
  event: { source: string; externalId: string },
): Promise<void> {
  await db
    .update(webhookEvents)
    .set({ processedAt: new Date() })
    .where(
      and(
        eq(webhookEvents.organizationId, requireUuid(organizationId, "organizationId")),
        eq(webhookEvents.source, event.source),
        eq(webhookEvents.externalId, event.externalId),
      ),
    );
}

import {
  jobErrorCode,
  ProviderError,
  type InvoiceProvider,
  type RateLimit,
  type SyncInvoicesPayload,
} from "@bystro/core";
import {
  applyConnectionEvent,
  getConnection,
  readConnectionTokens,
  updateConnectionTokens,
  writeAudit,
  type ConnectionTokens,
  type Db,
  type IntegrationConnection,
} from "@bystro/db";
import {
  OAuthError,
  refreshAccessToken,
  syncInvoices,
  withRequestHook,
  type OAuthProviderConfig,
} from "@bystro/integrations";

import { PermanentJobError, type JobHandler } from "../processing";
import { RateLimitedError, type RateLimiter } from "../rate-limiter";

/** Everything needed to talk to one invoicing system on behalf of one connection. */
export interface InvoiceProviderSetup {
  /** For refreshing the access token; `null` when the provider's tokens do not expire. */
  oauth: OAuthProviderConfig | null;
  /** The provider's request limit and the key it is counted under. */
  rateLimit: { key: string; limit: RateLimit };
  create(tokens: ConnectionTokens): InvoiceProvider;
}

/** Returns the setup for a connection, or `null` when its provider is not configured here. */
export type InvoiceProviderResolver = (
  connection: IntegrationConnection,
) => InvoiceProviderSetup | null;

export interface SyncInvoicesDeps {
  db: Db;
  encryptionKey: Buffer;
  rateLimiter: RateLimiter;
  resolveProvider: InvoiceProviderResolver;
  now?: () => Date;
  /** Injectable for tests; used for the token refresh request. */
  fetch?: typeof fetch;
}

/** Refresh the access token when it expires within this time. */
const REFRESH_AHEAD_MS = 5 * 60 * 1000;
/** A sync marked as running for longer than this was interrupted (crash, deploy). */
const STALE_SYNC_MS = 30 * 60 * 1000;

const SYSTEM = { actor: { type: "system" as const }, source: "worker" as const };

/**
 * Syncs one invoicing connection: refreshes the token if needed, runs the sync within the
 * provider's rate limit, and records the outcome on the connection and in the audit log.
 * Tokens are decrypted only in memory and never logged.
 */
export function syncInvoicesHandler(deps: SyncInvoicesDeps): JobHandler<SyncInvoicesPayload> {
  const now = deps.now ?? (() => new Date());
  const { db } = deps;

  async function freshTokens(
    connection: IntegrationConnection,
    setup: InvoiceProviderSetup,
    tokens: ConnectionTokens,
  ): Promise<ConnectionTokens> {
    const expiresSoon =
      tokens.expiresAt !== null && tokens.expiresAt.getTime() - now().getTime() < REFRESH_AHEAD_MS;
    if (!expiresSoon) {
      return tokens;
    }
    if (setup.oauth === null || tokens.refreshToken === null) {
      throw new ProviderError("reauth_required");
    }
    const refreshed = await refreshAccessToken(
      setup.oauth,
      { refreshToken: tokens.refreshToken },
      { now: now(), ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }) },
    );
    const updated: ConnectionTokens = {
      accessToken: refreshed.accessToken,
      // Providers that do not rotate refresh tokens return none: keep the one we have.
      refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
      expiresAt: refreshed.expiresAt,
    };
    await updateConnectionTokens(
      db,
      connection.organizationId,
      connection.id,
      updated,
      deps.encryptionKey,
    );
    return updated;
  }

  return async ({ data, logger }) => {
    const { organizationId, connectionId, mode } = data;
    const connection = await getConnection(db, organizationId, connectionId);
    if (connection === null) {
      throw new PermanentJobError("connection_not_found");
    }
    if (connection.status === "revoked" || connection.status === "reauth_required") {
      logger.info({ status: connection.status }, "Invoice sync skipped: connection is not usable");
      return;
    }

    const setup = deps.resolveProvider(connection);
    if (setup === null) {
      throw new PermanentJobError("provider_not_configured");
    }
    const tokens = await readConnectionTokens(db, organizationId, connectionId, deps.encryptionKey);
    if (tokens === null) {
      throw new PermanentJobError("credentials_missing");
    }

    if (connection.status === "syncing") {
      const startedAt = connection.lastSyncStartedAt?.getTime() ?? 0;
      if (now().getTime() - startedAt < STALE_SYNC_MS) {
        logger.info("Invoice sync skipped: another run is in progress");
        return;
      }
      await applyConnectionEvent(db, organizationId, connectionId, "sync_failed", {
        ...SYSTEM,
        errorCode: "sync_interrupted",
      });
    }
    await applyConnectionEvent(db, organizationId, connectionId, "sync_started", SYSTEM);

    const fail = (event: "sync_degraded" | "sync_failed" | "auth_failed", errorCode: string) =>
      applyConnectionEvent(db, organizationId, connectionId, event, { ...SYSTEM, errorCode });

    try {
      const current = await freshTokens(connection, setup, tokens);
      const provider = withRequestHook(setup.create(current), () =>
        deps.rateLimiter.require(setup.rateLimit.key, setup.rateLimit.limit),
      );
      const result = await syncInvoices({
        db,
        scope: { organizationId, connectionId },
        provider,
        mode,
        now: now(),
      });

      await applyConnectionEvent(db, organizationId, connectionId, "sync_succeeded", SYSTEM);
      // Counts only: no amounts, names or e-mails.
      const summary = {
        mode: result.mode,
        clientsCreated: result.clients.created,
        clientsUpdated: result.clients.updated,
        invoicesCreated: result.invoices.created,
        invoicesUpdated: result.invoices.updated,
        invoicesDeleted: result.invoices.deleted,
        paymentsCreated: result.payments.created,
        paymentsUpdated: result.payments.updated,
        paymentsRemoved: result.payments.removed,
      };
      await writeAudit(db, organizationId, {
        ...SYSTEM,
        action: "invoices.synced",
        target: { type: "integration_connection", id: connectionId },
        metadata: { provider: connection.provider, ...summary },
      });
      logger.info({ provider: connection.provider, ...summary }, "Invoices synced");
    } catch (error) {
      if (error instanceof RateLimitedError) {
        await fail("sync_degraded", "rate_limited");
        throw error;
      }
      if (error instanceof ProviderError) {
        if (error.code === "rate_limited") {
          await fail("sync_degraded", error.code);
          throw new RateLimitedError(error.retryAfterMs ?? setup.rateLimit.limit.windowMs);
        }
        if (error.code === "reauth_required") {
          await fail("auth_failed", error.code);
          throw new PermanentJobError(error.code);
        }
        if (error.retryable) {
          await fail("sync_degraded", error.code);
          throw error;
        }
        await fail("sync_failed", error.code);
        throw new PermanentJobError(error.code);
      }
      if (error instanceof OAuthError) {
        if (error.code === "reauthorization_required") {
          await fail("auth_failed", "reauth_required");
          throw new PermanentJobError("reauth_required");
        }
        // The provider's token endpoint is having a bad moment: try again later.
        await fail("sync_degraded", "provider_unavailable");
        throw new ProviderError("provider_unavailable");
      }
      await fail("sync_failed", jobErrorCode(error));
      throw error;
    }
  };
}

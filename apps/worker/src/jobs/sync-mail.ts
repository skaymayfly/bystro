import { jobErrorCode, ProviderError, type RateLimit, type SyncMailPayload } from "@bystro/core";
import {
  applyConnectionEvent,
  getConnection,
  markSyncProgress,
  readConnectionTokens,
  writeAudit,
  type ConnectionTokens,
  type Db,
  type IntegrationConnection,
} from "@bystro/db";
import {
  freshConnectionTokens,
  OAuthError,
  syncMail,
  type MailboxReader,
  type OAuthProviderConfig,
} from "@bystro/integrations";

import { PermanentJobError, type JobHandler } from "../processing";
import { RateLimitedError, waitForRateLimit, type RateLimiter } from "../rate-limiter";

/** Everything needed to read one mailbox on behalf of one connection. */
export interface MailboxSetup {
  oauth: OAuthProviderConfig | null;
  /** The mailbox's quota (in the provider's units) and the key it is counted under. */
  rateLimit: { key: string; limit: RateLimit };
  /** `onRequest` is called with the cost of every request before it is sent. */
  create(tokens: ConnectionTokens, onRequest: (cost: number) => Promise<void>): MailboxReader;
}

/** Returns the setup for a connection, or `null` when its provider is not configured here. */
export type MailboxResolver = (connection: IntegrationConnection) => MailboxSetup | null;

export interface SyncMailDeps {
  db: Db;
  encryptionKey: Buffer;
  rateLimiter: RateLimiter;
  resolveMailbox: MailboxResolver;
  now?: () => Date;
  /** Injectable for tests; used for the token refresh request. */
  fetch?: typeof fetch;
  /** Injectable for tests; how the job waits for quota. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * A running sync reports progress after every stored batch, and waits for quota at most
 * MAX_QUOTA_WAIT_MS between two batches. One silent for longer than this was interrupted
 * (crash, deploy); one that keeps reporting is left alone however long it runs.
 */
const STALE_SYNC_MS = 15 * 60 * 1000;
/**
 * How long a run waits for quota before it gives up and is put back. A first sync of a
 * busy mailbox spends minutes at Gmail's per-minute quota; waiting inside the job keeps
 * its progress, and a stopped run resumes cheaply anyway.
 */
const MAX_QUOTA_WAIT_MS = 5 * 60 * 1000;

const SYSTEM = { actor: { type: "system" as const }, source: "worker" as const };

/**
 * Syncs one mailbox: refreshes the token if needed, runs the sync within the mailbox's
 * quota, and records the outcome on the connection and in the audit log. Counts only:
 * nothing from the mailbox (addresses, subjects, text) reaches a log or the audit.
 */
export function syncMailHandler(deps: SyncMailDeps): JobHandler<SyncMailPayload> {
  const now = deps.now ?? (() => new Date());
  const { db } = deps;

  return async ({ data, logger }) => {
    const { organizationId, connectionId, mode } = data;
    const connection = await getConnection(db, organizationId, connectionId);
    if (connection === null) {
      throw new PermanentJobError("connection_not_found");
    }
    if (connection.category !== "email") {
      throw new PermanentJobError("not_a_mailbox");
    }
    if (connection.status === "revoked" || connection.status === "reauth_required") {
      logger.info({ status: connection.status }, "Mail sync skipped: connection is not usable");
      return;
    }
    if (connection.status === "syncing") {
      const lastSign = Math.max(
        connection.lastSyncStartedAt?.getTime() ?? 0,
        connection.syncProgressAt?.getTime() ?? 0,
      );
      if (now().getTime() - lastSign < STALE_SYNC_MS) {
        logger.info("Mail sync skipped: another run is in progress");
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

    const setup = deps.resolveMailbox(connection);
    if (setup === null) {
      await fail("sync_failed", "provider_not_configured");
      throw new PermanentJobError("provider_not_configured");
    }
    const tokens = await readConnectionTokens(db, organizationId, connectionId, deps.encryptionKey);
    if (tokens === null) {
      await fail("sync_failed", "credentials_missing");
      throw new PermanentJobError("credentials_missing");
    }

    try {
      const current = await freshConnectionTokens(
        {
          db,
          encryptionKey: deps.encryptionKey,
          now,
          ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
        },
        connection,
        setup.oauth,
        tokens,
      );
      const reader = setup.create(current, (cost) =>
        waitForRateLimit(deps.rateLimiter, setup.rateLimit.key, setup.rateLimit.limit, cost, {
          maxWaitMs: MAX_QUOTA_WAIT_MS,
          ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
        }),
      );
      const result = await syncMail({
        db,
        scope: { organizationId, connectionId },
        reader,
        mode,
        encryptionKey: deps.encryptionKey,
        now: now(),
        onProgress: () => markSyncProgress(db, organizationId, connectionId, now()),
      });

      await applyConnectionEvent(db, organizationId, connectionId, "sync_succeeded", SYSTEM);
      const summary = {
        mode: result.mode,
        historyExpired: result.historyExpired,
        messagesCreated: result.created,
        messagesUpdated: result.updated,
        labelsChanged: result.labelsChanged,
        messagesDeleted: result.deleted,
        messagesExpired: result.expired,
      };
      await writeAudit(db, organizationId, {
        ...SYSTEM,
        action: "mail.synced",
        target: { type: "integration_connection", id: connectionId },
        metadata: { provider: connection.provider, ...summary },
      });
      logger.info({ provider: connection.provider, ...summary }, "Mail synced");
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
        // Google refuses the refresh token: in testing mode it lives 7 days, or the user
        // removed Bystro's access. Only connecting again helps.
        if (error.code === "reauthorization_required") {
          await fail("auth_failed", "reauth_required");
          throw new PermanentJobError("reauth_required");
        }
        await fail("sync_degraded", "provider_unavailable");
        throw new ProviderError("provider_unavailable");
      }
      await fail("sync_failed", jobErrorCode(error));
      throw error;
    }
  };
}

import type { EmptyPayload } from "@bystro/core";

import type { JobHandler } from "../processing";

/** Expired requests are kept for a day so that a failed authorization can still be traced. */
export const OAUTH_REQUEST_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface CleanupOAuthRequestsDeps {
  /** Deletes requests that expired before the given moment and returns how many. */
  deleteExpiredBefore: (moment: Date) => Promise<number>;
  now?: () => Date;
}

/**
 * Removes OAuth requests that expired more than a day ago. Idempotent: a second run finds
 * nothing left to delete.
 */
export function cleanupOAuthRequestsHandler(
  deps: CleanupOAuthRequestsDeps,
): JobHandler<EmptyPayload> {
  const now = deps.now ?? (() => new Date());
  return async ({ logger }) => {
    const removed = await deps.deleteExpiredBefore(
      new Date(now().getTime() - OAUTH_REQUEST_RETENTION_MS),
    );
    logger.info({ removed }, "Expired OAuth requests removed");
  };
}

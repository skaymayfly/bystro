/** What kind of system a connection talks to. */
export const INTEGRATION_CATEGORIES = ["invoicing", "banking", "email", "calendar", "crm"] as const;
export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number];

/**
 * Health of a connection to an external system:
 * - `connected`: authorized, last sync fine, idle
 * - `syncing`: a sync is running
 * - `degraded`: works, but the last sync hit a temporary problem (rate limit, provider outage)
 * - `reauth_required`: the provider rejected our credentials; the user must connect again
 * - `revoked`: disconnected by the user or access withdrawn at the provider; no tokens kept
 * - `error`: the last sync failed for a reason that will not fix itself
 */
export const INTEGRATION_STATUSES = [
  "connected",
  "syncing",
  "degraded",
  "reauth_required",
  "revoked",
  "error",
] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

/** Things that happen to a connection and may change its status. */
export const INTEGRATION_EVENTS = [
  "sync_started",
  "sync_succeeded",
  "sync_degraded",
  "sync_failed",
  "auth_failed",
  "reconnected",
  "revoked",
] as const;
export type IntegrationEvent = (typeof INTEGRATION_EVENTS)[number];

const TRANSITIONS: Record<
  IntegrationStatus,
  Partial<Record<IntegrationEvent, IntegrationStatus>>
> = {
  connected: {
    sync_started: "syncing",
    auth_failed: "reauth_required",
    revoked: "revoked",
  },
  syncing: {
    sync_succeeded: "connected",
    sync_degraded: "degraded",
    sync_failed: "error",
    auth_failed: "reauth_required",
    revoked: "revoked",
  },
  degraded: {
    sync_started: "syncing",
    auth_failed: "reauth_required",
    revoked: "revoked",
  },
  error: {
    sync_started: "syncing",
    auth_failed: "reauth_required",
    revoked: "revoked",
  },
  // Only a fresh authorization brings these two back.
  reauth_required: {
    reconnected: "connected",
    revoked: "revoked",
  },
  revoked: {
    reconnected: "connected",
  },
};

/** Thrown when an event is not allowed in the connection's current status. */
export class IntegrationTransitionError extends Error {
  override name = "IntegrationTransitionError";

  constructor(
    readonly status: IntegrationStatus,
    readonly event: IntegrationEvent,
  ) {
    super(`Integration in status "${status}" cannot handle event "${event}".`);
  }
}

/** Returns the status after `event`, or throws {@link IntegrationTransitionError}. */
export function transitionIntegration(
  status: IntegrationStatus,
  event: IntegrationEvent,
): IntegrationStatus {
  const next = TRANSITIONS[status][event];
  if (next === undefined) {
    throw new IntegrationTransitionError(status, event);
  }
  return next;
}

/** Whether `event` is allowed in `status`. */
export function canTransitionIntegration(
  status: IntegrationStatus,
  event: IntegrationEvent,
): boolean {
  return TRANSITIONS[status][event] !== undefined;
}

/** Whether a new sync may start: not while one runs and not without valid credentials. */
export function canStartSync(status: IntegrationStatus): boolean {
  return canTransitionIntegration(status, "sync_started");
}

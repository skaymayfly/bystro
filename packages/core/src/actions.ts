/**
 * Actions: the one way Bystro does something on the user's behalf (send a reminder, …).
 * Every action is proposed first, carries why it exists and what it will do, and goes
 * through a fixed set of states. See chapter 13 of the specification.
 *
 * Pure logic: the data layer stores actions and calls {@link transitionAction} inside a
 * transaction, so a forbidden change never reaches the database.
 */

/** Kinds of actions. More come with the features that need them. */
export const ACTION_TYPES = [
  /** Remind a client of an overdue invoice (step 5.7). */
  "invoice_reminder",
  /** Send an e-mail the user wrote in Pošta: a reply or a new message (step 5.6). */
  "mail_send",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/**
 * - `proposed`: suggested, waiting for a decision
 * - `approved`: the user said yes (or no approval was needed); not started yet
 * - `executing`: being carried out
 * - `succeeded` / `failed`: carried out, with this outcome
 * - `verified`: the outcome was checked (e.g. the reminded invoice got paid)
 * - `rejected`: the user said no
 * - `expired`: no longer valid (too late, or the reason went away before it was carried out)
 */
export const ACTION_STATUSES = [
  "proposed",
  "approved",
  "executing",
  "succeeded",
  "failed",
  "verified",
  "rejected",
  "expired",
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const ACTION_EVENTS = [
  "approve",
  "reject",
  "expire",
  "start",
  "succeed",
  "fail",
  "verify",
] as const;
export type ActionEvent = (typeof ACTION_EVENTS)[number];

/**
 * - `user`: a person has to approve it (everything sensitive: sending e-mails, changing
 *   calendars or CRM)
 * - `none`: may run without asking (e.g. creating a task for the user)
 */
export const ACTION_APPROVAL_LEVELS = ["user", "none"] as const;
export type ActionApprovalLevel = (typeof ACTION_APPROVAL_LEVELS)[number];

/** A user's answer to an action. */
export const APPROVAL_DECISIONS = ["approved", "rejected"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

const TRANSITIONS: Record<ActionStatus, Partial<Record<ActionEvent, ActionStatus>>> = {
  proposed: { approve: "approved", reject: "rejected", expire: "expired" },
  // Before it starts, an approved action can still turn out to be pointless (the invoice got
  // paid in the meantime): it expires instead of running.
  approved: { start: "executing", expire: "expired" },
  // Once started it is carried to an outcome; it cannot expire half-way.
  executing: { succeed: "succeeded", fail: "failed" },
  succeeded: { verify: "verified" },
  // A failed action is final: trying again is a new proposal with its own approval.
  failed: {},
  verified: {},
  rejected: {},
  expired: {},
};

/** States nothing can leave. */
export const FINAL_ACTION_STATUSES: readonly ActionStatus[] = ACTION_STATUSES.filter(
  (status) => Object.keys(TRANSITIONS[status]).length === 0,
);

/** Thrown when an event is not allowed in the action's current state. */
export class ActionTransitionError extends Error {
  override name = "ActionTransitionError";

  constructor(
    readonly status: ActionStatus,
    readonly event: ActionEvent,
  ) {
    super(`Action in status "${status}" cannot handle event "${event}".`);
  }
}

/** Returns the state after `event`, or throws {@link ActionTransitionError}. */
export function transitionAction(status: ActionStatus, event: ActionEvent): ActionStatus {
  const next = TRANSITIONS[status][event];
  if (next === undefined) {
    throw new ActionTransitionError(status, event);
  }
  return next;
}

export function canTransitionAction(status: ActionStatus, event: ActionEvent): boolean {
  return TRANSITIONS[status][event] !== undefined;
}

/**
 * Whether the action is past its validity: from the `expiresAt` moment on it may no longer
 * be approved or started. An action without a limit never expires by time.
 */
export function isActionExpired(action: { expiresAt: Date | null }, now: Date): boolean {
  return action.expiresAt !== null && now.getTime() >= action.expiresAt.getTime();
}

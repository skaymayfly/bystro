import {
  isActionExpired,
  transitionAction,
  type ActionApprovalLevel,
  type ActionEvent,
  type ActionStatus,
  type ActionType,
  type ApprovalDecision,
  type AuditSource,
  type JsonValue,
} from "@bystro/core";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";

import { writeAudit, type AuditActor } from "./audit";
import type { Db, DbExecutor } from "./client";
import { requireUuid } from "./ids";
import { actions, approvals, type ActionSourceRef } from "./schema/actions";

/**
 * Actions and their approvals. Every function works inside the organization it is given;
 * every change of state goes through the state machine in `@bystro/core` and leaves an
 * audit record in the same transaction. The audit holds codes and states only, never the
 * preview (it may contain an e-mail address or a message).
 */

export type StoredAction = typeof actions.$inferSelect;
export type StoredApproval = typeof approvals.$inferSelect;
export type { ActionSourceRef };

export class ActionNotFoundError extends Error {
  override name = "ActionNotFoundError";
}

/** The action is past its validity; it has been marked `expired` and nothing else happened. */
export class ActionExpiredError extends Error {
  override name = "ActionExpiredError";

  constructor(readonly action: StoredAction) {
    super("The action has expired.");
  }
}

/** An action that needs a person's decision cannot be approved by the system. */
export class ApprovalRequiredError extends Error {
  override name = "ApprovalRequiredError";
}

const CODE = /^[a-z0-9_.]{1,64}$/;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

export interface ProposeActionInput {
  type: ActionType;
  /** Why it exists, e.g. "invoice_overdue". */
  triggerCode: string;
  triggerData?: { [key: string]: JsonValue };
  sources: ActionSourceRef[];
  preview: { [key: string]: JsonValue };
  approvalLevel: ActionApprovalLevel;
  expiresAt: Date | null;
  /** Same key, same action: proposing again returns the existing one. */
  idempotencyKey: string;
  proposedBy: AuditActor;
  source: AuditSource;
}

export interface ProposedAction {
  action: StoredAction;
  /** `false` when an action with the same idempotency key already existed. */
  created: boolean;
}

function validateProposal(input: ProposeActionInput): void {
  if (!CODE.test(input.triggerCode)) {
    throw new RangeError("triggerCode must be a short lower-case code.");
  }
  const key = input.idempotencyKey;
  if (key.trim() === "" || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new RangeError(`idempotencyKey must have 1–${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`);
  }
  for (const source of input.sources) {
    if (!CODE.test(source.type) || source.id.trim() === "") {
      throw new RangeError("Every source needs a type code and an id.");
    }
  }
}

/** Proposes an action. Idempotent: the same key in the same organization adds nothing. */
export async function proposeAction(
  db: Db,
  organizationId: string,
  input: ProposeActionInput,
): Promise<ProposedAction> {
  const orgId = requireUuid(organizationId, "organizationId");
  validateProposal(input);

  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(actions)
      .values({
        organizationId: orgId,
        type: input.type,
        triggerCode: input.triggerCode,
        triggerData: input.triggerData ?? {},
        sources: input.sources,
        preview: input.preview,
        approvalLevel: input.approvalLevel,
        expiresAt: input.expiresAt,
        idempotencyKey: input.idempotencyKey,
        proposedByType: input.proposedBy.type,
        proposedByUserId:
          input.proposedBy.userId === undefined
            ? null
            : requireUuid(input.proposedBy.userId, "proposedBy.userId"),
      })
      .onConflictDoNothing({ target: [actions.organizationId, actions.idempotencyKey] })
      .returning();

    if (inserted === undefined) {
      const [existing] = await tx
        .select()
        .from(actions)
        .where(
          and(eq(actions.organizationId, orgId), eq(actions.idempotencyKey, input.idempotencyKey)),
        );
      if (existing === undefined) {
        throw new Error("Action vanished between insert and select.");
      }
      return { action: existing, created: false };
    }

    await writeAudit(tx, orgId, {
      actor: input.proposedBy,
      action: "action.proposed",
      target: { type: "action", id: inserted.id },
      source: input.source,
      metadata: {
        type: inserted.type,
        triggerCode: inserted.triggerCode,
        approvalLevel: inserted.approvalLevel,
      },
    });
    return { action: inserted, created: true };
  });
}

async function requireAction(
  executor: DbExecutor,
  organizationId: string,
  actionId: string,
  options: { lock?: boolean } = {},
): Promise<StoredAction> {
  const query = executor
    .select()
    .from(actions)
    .where(
      and(
        eq(actions.organizationId, organizationId),
        eq(actions.id, requireUuid(actionId, "actionId")),
      ),
    );
  const [row] = await (options.lock === true ? query.for("update") : query);
  if (row === undefined) {
    throw new ActionNotFoundError("Action not found in this organization.");
  }
  return row;
}

export async function getAction(
  db: Db,
  organizationId: string,
  actionId: string,
): Promise<StoredAction | null> {
  const orgId = requireUuid(organizationId, "organizationId");
  try {
    return await requireAction(db, orgId, actionId);
  } catch (error) {
    if (error instanceof ActionNotFoundError) return null;
    throw error;
  }
}

/** Actions of the organization, newest first, optionally only in some states. */
export async function listActions(
  db: Db,
  organizationId: string,
  filter: { statuses?: readonly ActionStatus[] } = {},
): Promise<StoredAction[]> {
  const orgId = requireUuid(organizationId, "organizationId");
  const statuses = filter.statuses;
  if (statuses !== undefined && statuses.length === 0) {
    return [];
  }
  return db
    .select()
    .from(actions)
    .where(
      and(
        eq(actions.organizationId, orgId),
        statuses === undefined ? undefined : inArray(actions.status, [...statuses]),
      ),
    )
    .orderBy(desc(actions.createdAt), desc(actions.id));
}

/** The decision about an action, or `null` while there is none. */
export async function getApproval(
  db: Db,
  organizationId: string,
  actionId: string,
): Promise<StoredApproval | null> {
  const orgId = requireUuid(organizationId, "organizationId");
  const [row] = await db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.organizationId, orgId),
        eq(approvals.actionId, requireUuid(actionId, "actionId")),
      ),
    );
  return row ?? null;
}

interface TransitionContext {
  actor: AuditActor;
  source: AuditSource;
  now: Date;
  errorCode?: string;
  resultReference?: string;
  /** Extra audit metadata (codes only). */
  metadata?: Record<string, unknown>;
}

/** Moves a locked action to its next state and audits it, inside the caller's transaction. */
async function moveAction(
  tx: DbExecutor,
  current: StoredAction,
  event: ActionEvent,
  context: TransitionContext,
): Promise<StoredAction> {
  const status = transitionAction(current.status, event);
  if (context.errorCode !== undefined && !CODE.test(context.errorCode)) {
    throw new RangeError("errorCode must be a short lower-case code.");
  }
  const [updated] = await tx
    .update(actions)
    .set({
      status,
      statusChangedAt: context.now,
      ...(event === "fail" || event === "succeed" ? { executedAt: context.now } : {}),
      ...(event === "fail" ? { errorCode: context.errorCode ?? "failed" } : {}),
      ...(event === "succeed" && context.resultReference !== undefined
        ? { resultReference: context.resultReference }
        : {}),
    })
    .where(eq(actions.id, current.id))
    .returning();
  if (updated === undefined) {
    throw new Error("Action update returned no row.");
  }

  await writeAudit(tx, current.organizationId, {
    actor: context.actor,
    action: "action.status_changed",
    target: { type: "action", id: current.id },
    source: context.source,
    result: event === "fail" ? "failure" : "success",
    metadata: {
      type: current.type,
      event,
      from: current.status,
      to: status,
      ...(event === "fail" ? { errorCode: context.errorCode ?? "failed" } : {}),
      ...context.metadata,
    },
  });
  return updated;
}

/** Events that need the action to be still valid. */
const NEEDS_VALIDITY: ReadonlySet<ActionEvent> = new Set(["approve", "start"]);

/**
 * Applies an event decided by the system: `start`, `succeed`, `fail`, `verify`, `expire`,
 * and `approve` for actions that need no person's decision. A person's decision goes
 * through {@link decideAction}.
 *
 * An action past its validity is not approved or started: it is marked `expired` (with an
 * audit record) and {@link ActionExpiredError} is thrown.
 */
export async function applyActionEvent(
  db: Db,
  organizationId: string,
  actionId: string,
  event: Exclude<ActionEvent, "reject">,
  context: Omit<TransitionContext, "now"> & { now?: Date },
): Promise<StoredAction> {
  const orgId = requireUuid(organizationId, "organizationId");
  const now = context.now ?? new Date();

  const outcome = await db.transaction(async (tx) => {
    const current = await requireAction(tx, orgId, actionId, { lock: true });
    if (event === "approve" && current.approvalLevel !== "none") {
      throw new ApprovalRequiredError("This action needs the user's approval.");
    }
    if (NEEDS_VALIDITY.has(event) && isActionExpired(current, now)) {
      const expired = await moveAction(tx, current, "expire", { ...context, now });
      return { action: expired, expired: true };
    }
    return { action: await moveAction(tx, current, event, { ...context, now }), expired: false };
  });
  if (outcome.expired) {
    throw new ActionExpiredError(outcome.action);
  }
  return outcome.action;
}

/**
 * Records a user's decision and moves the action to `approved` or `rejected`, in one
 * transaction. Only a proposed action can be decided; a second decision (e.g. a double
 * click or two people at once) fails with `ActionTransitionError` and changes nothing.
 * Approving an action past its validity marks it `expired` and throws {@link ActionExpiredError}.
 */
export async function decideAction(
  db: Db,
  organizationId: string,
  actionId: string,
  input: { userId: string; decision: ApprovalDecision; source: AuditSource; now?: Date },
): Promise<StoredAction> {
  const orgId = requireUuid(organizationId, "organizationId");
  const userId = requireUuid(input.userId, "userId");
  const now = input.now ?? new Date();
  const actor: AuditActor = { type: "user", userId };

  const outcome = await db.transaction(async (tx) => {
    const current = await requireAction(tx, orgId, actionId, { lock: true });
    const event: ActionEvent = input.decision === "approved" ? "approve" : "reject";
    // Checked before anything is written, so that a refused decision leaves no trace.
    transitionAction(current.status, event);

    if (event === "approve" && isActionExpired(current, now)) {
      const expired = await moveAction(tx, current, "expire", { actor, source: input.source, now });
      return { action: expired, expired: true };
    }
    await tx.insert(approvals).values({
      organizationId: orgId,
      actionId: current.id,
      userId,
      decision: input.decision,
      createdAt: now,
    });
    const moved = await moveAction(tx, current, event, {
      actor,
      source: input.source,
      now,
      metadata: { decision: input.decision },
    });
    return { action: moved, expired: false };
  });
  if (outcome.expired) {
    throw new ActionExpiredError(outcome.action);
  }
  return outcome.action;
}

/**
 * Actions of a type that have been `executing` since before `startedBefore`, in every
 * organization: their worker most likely stopped half-way (deploy, crash). System use only
 * (the worker's recovery job): identifiers only, each one is then handled inside its
 * organization.
 */
export async function listStuckActions(
  db: Db,
  type: ActionType,
  startedBefore: Date,
): Promise<{ organizationId: string; actionId: string }[]> {
  return db
    .select({ organizationId: actions.organizationId, actionId: actions.id })
    .from(actions)
    .where(
      and(
        eq(actions.type, type),
        eq(actions.status, "executing"),
        lt(actions.statusChangedAt, startedBefore),
      ),
    )
    .orderBy(actions.statusChangedAt);
}

/** Reminder actions about one invoice of the organization, newest first. */
export async function listInvoiceReminders(
  db: Db,
  organizationId: string,
  invoiceId: string,
): Promise<StoredAction[]> {
  const orgId = requireUuid(organizationId, "organizationId");
  const id = requireUuid(invoiceId, "invoiceId");
  return db
    .select()
    .from(actions)
    .where(
      and(
        eq(actions.organizationId, orgId),
        eq(actions.type, "invoice_reminder"),
        sql`${actions.sources} @> ${JSON.stringify([{ type: "invoice", id }])}::jsonb`,
      ),
    )
    .orderBy(desc(actions.createdAt), desc(actions.id));
}

/**
 * Replaces the preview of an action that is still waiting for a decision (the user edited
 * the text before sending). Returns `null` when the action is no longer proposed. The audit
 * records that it changed, never what it says.
 */
export async function updateProposedActionPreview(
  db: Db,
  organizationId: string,
  actionId: string,
  preview: { [key: string]: JsonValue },
  context: { userId: string; source: AuditSource },
): Promise<StoredAction | null> {
  const orgId = requireUuid(organizationId, "organizationId");
  const userId = requireUuid(context.userId, "userId");
  return db.transaction(async (tx) => {
    const current = await requireAction(tx, orgId, actionId, { lock: true });
    if (current.status !== "proposed") {
      return null;
    }
    const [updated] = await tx
      .update(actions)
      .set({ preview })
      .where(eq(actions.id, current.id))
      .returning();
    await writeAudit(tx, orgId, {
      actor: { type: "user", userId },
      action: "action.preview_edited",
      target: { type: "action", id: current.id },
      source: context.source,
      metadata: { type: current.type },
    });
    return updated ?? null;
  });
}

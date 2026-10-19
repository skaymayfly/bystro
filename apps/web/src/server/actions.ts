import {
  ActionTransitionError,
  buildJobId,
  executeActionJob,
  type ApprovalDecision,
  type ExecuteActionPayload,
  type Role,
} from "@bystro/core";
import {
  ActionExpiredError,
  applyActionEvent,
  checkActionStillValid,
  decideAction,
  getAction,
  getApproval,
  type Db,
  type StoredAction,
} from "@bystro/db";

/**
 * Approving and rejecting actions on behalf of the signed-in user. Route handlers stay
 * thin and call these functions. Before an approval everything is checked again: the
 * user's role, the action's validity and whether the data still calls for it. The action
 * itself is carried out by the worker, once.
 */

/** Who may decide about actions: they act in the company's name (e.g. write to a client). */
export const DECIDING_ROLES: ReadonlySet<Role> = new Set(["owner", "admin"]);

export type EnqueueExecution = (data: ExecuteActionPayload, jobId: string) => Promise<boolean>;

export interface ActionDecisionDeps {
  db: Db;
  enqueue: EnqueueExecution;
  now?: Date;
}

export interface ActionDecisionRequest {
  organizationId: string;
  userId: string;
  role: Role | null;
  actionId: string;
  decision: ApprovalDecision;
}

/** The API's view of an action after a decision (kapitola 23 of the specification). */
export interface ActionDecisionView {
  actionId: string;
  status: StoredAction["status"];
  executedAt: string | null;
  resultReference: string | null;
}

export type ActionDecisionResult =
  | { ok: true; view: ActionDecisionView }
  | {
      ok: false;
      error:
        | "forbidden"
        | "not_found"
        /** Decided otherwise already, or in a state where deciding makes no sense. */
        | "conflict"
        | "expired"
        /** The data changed and the action no longer makes sense; it was called off. */
        | "source_changed";
    };

export function toActionDecisionView(action: StoredAction): ActionDecisionView {
  return {
    actionId: action.id,
    status: action.status,
    executedAt: action.executedAt?.toISOString() ?? null,
    resultReference: action.resultReference,
  };
}

const executionJobId = (actionId: string) => buildJobId(executeActionJob.name, actionId);

/**
 * Hands an approved action to the worker. The job id is derived from the action, so asking
 * twice enqueues it once. A queue outage does not undo the approval: repeating the request
 * enqueues it again.
 */
async function enqueueExecution(deps: ActionDecisionDeps, action: StoredAction): Promise<void> {
  if (action.status !== "approved") {
    return;
  }
  await deps.enqueue(
    { organizationId: action.organizationId, actionId: action.id },
    executionJobId(action.id),
  );
}

/** A decision about an action that is no longer proposed: a repeat is fine, anything else not. */
async function alreadyDecided(
  deps: ActionDecisionDeps,
  action: StoredAction,
  decision: ApprovalDecision,
): Promise<ActionDecisionResult> {
  if (action.status === "expired") {
    return { ok: false, error: "expired" };
  }
  const approval = await getApproval(deps.db, action.organizationId, action.id);
  if (approval?.decision !== decision) {
    return { ok: false, error: "conflict" };
  }
  // The same decision again (a double click, a repeated request): nothing new happens.
  await enqueueExecution(deps, action);
  return { ok: true, view: toActionDecisionView(action) };
}

export async function decideOnAction(
  deps: ActionDecisionDeps,
  request: ActionDecisionRequest,
): Promise<ActionDecisionResult> {
  if (request.role === null || !DECIDING_ROLES.has(request.role)) {
    return { ok: false, error: "forbidden" };
  }
  const now = deps.now ?? new Date();
  const action = await getAction(deps.db, request.organizationId, request.actionId);
  if (action === null) {
    return { ok: false, error: "not_found" };
  }
  if (action.status !== "proposed") {
    return alreadyDecided(deps, action, request.decision);
  }

  if (request.decision === "approved") {
    const check = await checkActionStillValid(deps.db, action, now);
    if (!check.ok) {
      try {
        await applyActionEvent(deps.db, request.organizationId, action.id, "expire", {
          actor: { type: "user", userId: request.userId },
          source: "web",
          now,
          metadata: { reason: check.reason },
        });
      } catch (error) {
        if (!(error instanceof ActionTransitionError)) throw error;
      }
      return { ok: false, error: "source_changed" };
    }
  }

  let decided: StoredAction;
  try {
    decided = await decideAction(deps.db, request.organizationId, action.id, {
      userId: request.userId,
      decision: request.decision,
      source: "web",
      now,
    });
  } catch (error) {
    if (error instanceof ActionExpiredError) {
      return { ok: false, error: "expired" };
    }
    if (error instanceof ActionTransitionError) {
      // Someone (or another click) decided in the meantime.
      const current = await getAction(deps.db, request.organizationId, action.id);
      return current === null
        ? { ok: false, error: "not_found" }
        : alreadyDecided(deps, current, request.decision);
    }
    throw error;
  }
  await enqueueExecution(deps, decided);
  return { ok: true, view: toActionDecisionView(decided) };
}

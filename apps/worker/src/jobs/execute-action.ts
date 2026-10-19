import {
  ActionTransitionError,
  jobErrorCode,
  type ActionType,
  type ExecuteActionPayload,
} from "@bystro/core";
import {
  ActionExpiredError,
  applyActionEvent,
  checkActionStillValid,
  getAction,
  type Db,
  type StoredAction,
} from "@bystro/db";

import { PermanentJobError, type JobContext, type JobHandler } from "../processing";

/** What carrying out an action produced, e.g. the id of the sent message. */
export interface ActionExecutionResult {
  resultReference: string;
}

/** Carries out one kind of action. Must not be called twice for the same action. */
export type ActionExecutor = (
  action: StoredAction,
  context: Pick<JobContext<unknown>, "logger">,
) => Promise<ActionExecutionResult>;

/** Executors by action type. A type without one is never carried out. */
export type ActionExecutors = Partial<Record<ActionType, ActionExecutor>>;

export interface ExecuteActionDeps {
  db: Db;
  executors: ActionExecutors;
  now?: () => Date;
}

const SYSTEM = { actor: { type: "system" as const }, source: "worker" as const };
const ERROR_CODE = /^[a-z0-9_.]{1,64}$/;

/**
 * Carries out an approved action exactly once:
 * 1. only an action that is still `approved` is touched (a repeated job finds it moved on),
 * 2. right before, the data is checked again; an action whose reason went away expires,
 * 3. the move to `executing` happens under a row lock, so of two jobs only one gets past it,
 * 4. the outcome is recorded on the action (`succeeded` with a reference, or `failed` with a
 *    code). Nothing is retried: a second attempt could repeat what already happened outside.
 */
export function executeActionHandler(deps: ExecuteActionDeps): JobHandler<ExecuteActionPayload> {
  const now = deps.now ?? (() => new Date());
  const { db } = deps;

  return async ({ data, logger }) => {
    const { organizationId, actionId } = data;
    const action = await getAction(db, organizationId, actionId);
    if (action === null) {
      throw new PermanentJobError("action_not_found");
    }
    if (action.status !== "approved") {
      logger.info({ status: action.status }, "Action not executed: it is not waiting for it");
      return;
    }

    const check = await checkActionStillValid(db, action, now());
    if (!check.ok) {
      try {
        await applyActionEvent(db, organizationId, actionId, "expire", {
          ...SYSTEM,
          now: now(),
          metadata: { reason: check.reason },
        });
      } catch (error) {
        if (!(error instanceof ActionTransitionError)) throw error;
      }
      logger.info({ type: action.type, reason: check.reason }, "Action called off: data changed");
      return;
    }

    let started: StoredAction;
    try {
      started = await applyActionEvent(db, organizationId, actionId, "start", {
        ...SYSTEM,
        now: now(),
      });
    } catch (error) {
      if (error instanceof ActionTransitionError || error instanceof ActionExpiredError) {
        logger.info("Action not executed: it moved on in the meantime");
        return;
      }
      throw error;
    }

    const executor = deps.executors[started.type];
    if (executor === undefined) {
      await applyActionEvent(db, organizationId, actionId, "fail", {
        ...SYSTEM,
        now: now(),
        errorCode: "no_executor",
      });
      logger.warn({ type: started.type }, "Action failed: nothing can carry out this type yet");
      return;
    }

    let result: ActionExecutionResult;
    try {
      result = await executor(started, { logger });
    } catch (error) {
      const code = jobErrorCode(error);
      const errorCode = ERROR_CODE.test(code) ? code : "executor_error";
      await applyActionEvent(db, organizationId, actionId, "fail", {
        ...SYSTEM,
        now: now(),
        errorCode,
      });
      logger.warn({ type: started.type, errorCode }, "Action failed");
      return;
    }
    await applyActionEvent(db, organizationId, actionId, "succeed", {
      ...SYSTEM,
      now: now(),
      resultReference: result.resultReference,
    });
    logger.info({ type: started.type }, "Action carried out");
  };
}

import { executeActionJob, type ApprovalDecision } from "@bystro/core";
import { enqueue } from "@bystro/queue";

import { decideOnAction, type ActionDecisionResult } from "./actions";
import { isSameOrigin, json, requireApiContext } from "./api";
import { getDb } from "./db";
import { readAuthEnv } from "./env";
import { getQueues } from "./integrations";
import { logger } from "./logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS: Record<Exclude<ActionDecisionResult, { ok: true }>["error"], number> = {
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  source_changed: 409,
  expired: 410,
};

/**
 * Common handling of `POST /api/v1/actions/{id}/approve|reject`: signed in, same origin,
 * a company, a well-formed id; then {@link decideOnAction}. Answers
 * 200 { actionId, status, executedAt, resultReference } or { error } with 400, 401, 403,
 * 404, 409 (`conflict`, `source_changed`) or 410 (`expired`). Never the action's preview.
 */
export async function handleActionDecision(
  request: Request,
  params: Promise<{ id: string }>,
  decision: ApprovalDecision,
): Promise<Response> {
  const context = await requireApiContext();
  if (context instanceof Response) {
    return context;
  }
  if (!isSameOrigin(request, readAuthEnv().baseUrl)) {
    return json({ error: "forbidden" }, 403);
  }
  const { id } = await params;
  if (context.organization === null || !UUID.test(id)) {
    return json({ error: "not_found" }, 404);
  }

  const result = await decideOnAction(
    {
      db: getDb(),
      enqueue: (data, jobId) => enqueue(getQueues(), executeActionJob, data, { jobId }),
    },
    {
      organizationId: context.organization.id,
      userId: context.user.id,
      role: context.role,
      actionId: id,
      decision,
    },
  );
  if (!result.ok) {
    logger.info({ actionId: id, decision, error: result.error }, "Action decision refused");
    return json({ error: result.error }, STATUS[result.error]);
  }
  logger.info({ actionId: id, decision, status: result.view.status }, "Action decided");
  return json(result.view);
}

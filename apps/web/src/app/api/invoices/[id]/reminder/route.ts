import { executeActionJob } from "@bystro/core";
import { readEncryptionKey } from "@bystro/db";
import { enqueue } from "@bystro/queue";

import { isSameOrigin, json, requireApiContext } from "@/server/api";
import { getDb } from "@/server/db";
import { readAuthEnv } from "@/server/env";
import { getQueues } from "@/server/integrations";
import { logger } from "@/server/logger";
import { handleReminder, reminderRequestSchema } from "@/server/reminders";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS = {
  forbidden: 403,
  invalid: 400,
  not_found: 404,
  not_overdue: 409,
  no_mailbox: 409,
  conflict: 409,
} as const;

/**
 * POST /api/invoices/{id}/reminder — `{ decision: "send", to, subject, body, attachPdf }`
 * sends the reminder (the click is the approval), `{ decision: "dismiss" }` turns the
 * proposal down. Answers 202 { actionId, status }, or { error } with 400, 401, 403, 404 or
 * 409 (`not_overdue`, `no_mailbox`, `conflict`).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const body = reminderRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return json({ error: "invalid" }, 400);
  }
  const result = await handleReminder(
    {
      db: getDb(),
      encryptionKey: readEncryptionKey(),
      enqueue: (data, jobId) => enqueue(getQueues(), executeActionJob, data, { jobId }),
    },
    { organizationId: context.organization.id, userId: context.user.id, role: context.role },
    id,
    body.data,
  );
  if (!result.ok) {
    logger.info({ error: result.error }, "Reminder not handled");
    return json({ error: result.error }, STATUS[result.error]);
  }
  logger.info({ decision: body.data.decision, status: result.status }, "Reminder handled");
  return json({ actionId: result.actionId, status: result.status }, 202);
}

import { executeActionJob } from "@bystro/core";
import { readEncryptionKey } from "@bystro/db";
import { enqueue } from "@bystro/queue";

import { isSameOrigin, json, requireApiContext } from "@/server/api";
import { getDb } from "@/server/db";
import { readAuthEnv } from "@/server/env";
import { getQueues } from "@/server/integrations";
import { logger } from "@/server/logger";
import { sendMail, sendMailRequestSchema } from "@/server/mail-send";

const STATUS = {
  forbidden: 403,
  invalid: 400,
  not_found: 404,
  reauth_required: 409,
  conflict: 409,
} as const;

/**
 * POST /api/mail/send — body { clientKey, threadId, to, cc, subject, body }. Sends the
 * e-mail from the company's Gmail through an action the click approves. Answers
 * 202 { actionId, status }, or { error } with 400, 401, 403, 404 or 409. Sending the same
 * clientKey again does not send a second e-mail.
 */
export async function POST(request: Request) {
  const context = await requireApiContext();
  if (context instanceof Response) {
    return context;
  }
  if (!isSameOrigin(request, readAuthEnv().baseUrl)) {
    return json({ error: "forbidden" }, 403);
  }
  if (context.organization === null) {
    return json({ error: "not_found" }, 404);
  }
  const body = sendMailRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return json({ error: "invalid" }, 400);
  }

  const result = await sendMail(
    {
      db: getDb(),
      encryptionKey: readEncryptionKey(),
      enqueue: (data, jobId) => enqueue(getQueues(), executeActionJob, data, { jobId }),
    },
    { organizationId: context.organization.id, userId: context.user.id, role: context.role },
    body.data,
  );
  if (!result.ok) {
    logger.info({ error: result.error }, "Mail not sent");
    return json({ error: result.error }, STATUS[result.error]);
  }
  logger.info({ actionId: result.actionId, status: result.status }, "Mail handed over for sending");
  return json({ actionId: result.actionId, status: result.status }, 202);
}

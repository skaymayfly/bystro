import { readEncryptionKey } from "@bystro/db";

import { isSameOrigin, json, requireApiContext } from "@/server/api";
import { getDb } from "@/server/db";
import { readAuthEnv } from "@/server/env";
import { getGmail } from "@/server/integrations";
import { logger } from "@/server/logger";
import { archiveThread } from "@/server/mail";

/** Gmail thread ids are short strings of letters and digits. */
const THREAD_ID = /^[A-Za-z0-9_-]{1,100}$/;

const STATUS = { not_found: 404, reauth_required: 409, provider_unavailable: 503 } as const;

/**
 * POST /api/mail/threads/{id}/archive — archives the thread in Gmail and in Bystro.
 * Answers 204, or { error } with 401, 403 (other origin), 404 (no such thread in the
 * company's mailbox), 409 (`reauth_required`: Gmail has to be connected again) or 503.
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
  if (context.organization === null || !THREAD_ID.test(id)) {
    return json({ error: "not_found" }, 404);
  }

  const result = await archiveThread(
    { db: getDb(), encryptionKey: readEncryptionKey(), gmail: getGmail() },
    { organizationId: context.organization.id, userId: context.user.id },
    id,
  );
  if (!result.ok) {
    logger.info({ error: result.error }, "Mail thread not archived");
    return json({ error: result.error }, STATUS[result.error]);
  }
  logger.info("Mail thread archived");
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

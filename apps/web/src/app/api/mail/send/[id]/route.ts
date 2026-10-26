import { json, requireApiContext } from "@/server/api";
import { getDb } from "@/server/db";
import { mailSendStatus } from "@/server/mail-send";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/mail/send/{actionId} — { status, errorCode } of a message being sent; never its text. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireApiContext();
  if (context instanceof Response) {
    return context;
  }
  const { id } = await params;
  if (context.organization === null || !UUID.test(id)) {
    return json({ error: "not_found" }, 404);
  }
  const status = await mailSendStatus(getDb(), context.organization.id, id);
  return status === null ? json({ error: "not_found" }, 404) : json(status);
}

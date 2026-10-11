import { json } from "@/server/api";
import { connectionRequest } from "@/server/connection-route";
import { requestManualSync } from "@/server/connections";
import { getDb } from "@/server/db";
import { enqueueInvoiceSync } from "@/server/integrations";

/**
 * POST /api/integrations/connections/{id}/sync — "Aktualizovat": asks the worker to sync now.
 * 202 { status: "enqueued" } · 401 · 403 · 404 { error: "not_found" }
 * 409 { error: "not_syncable" } (needs reconnecting or an account)
 * 429 { error: "too_soon" } (at most once per five minutes) · 503 { error: "queue_unavailable" }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const input = await connectionRequest(request, params);
  if (input instanceof Response) {
    return input;
  }

  let result;
  try {
    result = await requestManualSync({ db: getDb(), enqueue: enqueueInvoiceSync }, input);
  } catch {
    return json({ error: "queue_unavailable" }, 503);
  }
  switch (result) {
    case "enqueued":
      return json({ status: "enqueued" }, 202);
    case "too_soon":
      return json({ error: "too_soon" }, 429);
    case "not_syncable":
      return json({ error: "not_syncable" }, 409);
    case "not_found":
      return json({ error: "not_found" }, 404);
  }
}

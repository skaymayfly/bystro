import { readEncryptionKey } from "@bystro/db";

import { json } from "@/server/api";
import { connectionRequest } from "@/server/connection-route";
import { disconnect } from "@/server/connections";
import { getDb } from "@/server/db";
import { getFakturoid, getIdoklad } from "@/server/integrations";
import { logger } from "@/server/logger";

/**
 * POST /api/integrations/connections/{id}/disconnect — "Odpojit": revokes the access at
 * the provider, deletes the tokens and hides the data synced through the connection.
 * 200 { status: "disconnected" } · 401 · 403 · 404 { error: "not_found" }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const input = await connectionRequest(request, params);
  if (input instanceof Response) {
    return input;
  }

  const done = await disconnect(
    {
      db: getDb(),
      encryptionKey: readEncryptionKey(),
      fakturoid: getFakturoid(),
      idoklad: getIdoklad(),
    },
    input,
  );
  if (!done) {
    return json({ error: "not_found" }, 404);
  }
  logger.info({ connectionId: input.connectionId }, "Integration disconnected");
  return json({ status: "disconnected" });
}

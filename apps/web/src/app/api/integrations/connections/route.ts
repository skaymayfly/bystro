import { listConnections } from "@bystro/db";

import { json, requireApiContext } from "@/server/api";
import { getDb } from "@/server/db";
import { toConnectionView } from "@/server/integrations";

/**
 * GET /api/integrations/connections — connections of the signed-in user's company.
 * 200 { connections: [{ id, provider, status, displayName, needsAccount, lastSyncAt,
 * lastErrorCode }] } · 401. Never contains tokens.
 */
export async function GET() {
  const context = await requireApiContext();
  if (context instanceof Response) {
    return context;
  }
  if (context.organization === null) {
    return json({ connections: [] });
  }
  const connections = await listConnections(getDb(), context.organization.id);
  return json({
    connections: connections
      .filter((connection) => connection.status !== "revoked")
      .map(toConnectionView),
  });
}

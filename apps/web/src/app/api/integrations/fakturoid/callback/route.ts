import { finishConnection } from "@/server/connect-routes";

/** GET /api/integrations/fakturoid/callback — see {@link finishConnection}. */
export function GET(request: Request) {
  return finishConnection(request, "fakturoid");
}

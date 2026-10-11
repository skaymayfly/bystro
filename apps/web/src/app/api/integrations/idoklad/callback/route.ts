import { finishConnection } from "@/server/connect-routes";

/** GET /api/integrations/idoklad/callback — see {@link finishConnection}. */
export function GET(request: Request) {
  return finishConnection(request, "idoklad");
}

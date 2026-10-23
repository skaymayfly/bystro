import { finishConnection } from "@/server/connect-routes";

/** GET /api/integrations/gmail/callback — see {@link finishConnection}. */
export function GET(request: Request) {
  return finishConnection(request, "gmail");
}

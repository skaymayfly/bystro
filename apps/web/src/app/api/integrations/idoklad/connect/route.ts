import { startConnection } from "@/server/connect-routes";

/** POST /api/integrations/idoklad/connect — see {@link startConnection}. */
export function POST(request: Request) {
  return startConnection(request, "idoklad");
}

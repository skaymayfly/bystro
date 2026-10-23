import { startConnection } from "@/server/connect-routes";

/** POST /api/integrations/gmail/connect — see {@link startConnection}. */
export function POST(request: Request) {
  return startConnection(request, "gmail");
}

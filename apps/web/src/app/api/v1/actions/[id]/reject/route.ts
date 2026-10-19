import { handleActionDecision } from "@/server/action-route";

/** POST /api/v1/actions/{id}/reject — rejects the action. See {@link handleActionDecision}. */
export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleActionDecision(request, params, "rejected");
}

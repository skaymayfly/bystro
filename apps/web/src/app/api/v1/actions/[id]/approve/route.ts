import { z } from "zod";

import { handleActionDecision } from "@/server/action-route";
import { json } from "@/server/api";

const bodySchema = z.strictObject({ approval: z.literal(true) });

/**
 * POST /api/v1/actions/{id}/approve — body `{ "approval": true }`. Approves the action and
 * hands it to the worker. See {@link handleActionDecision} for the answers.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const body: unknown = await request.json().catch(() => null);
  if (!bodySchema.safeParse(body).success) {
    return json({ error: "invalid_request" }, 400);
  }
  return handleActionDecision(request, params, "approved");
}

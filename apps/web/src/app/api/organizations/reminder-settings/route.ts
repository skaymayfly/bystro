import { setReminderSettings } from "@bystro/db";
import { z } from "zod";

import { isSameOrigin, json, requireApiContext } from "@/server/api";
import { DECIDING_ROLES } from "@/server/actions";
import { getDb } from "@/server/db";
import { readAuthEnv } from "@/server/env";

const bodySchema = z.strictObject({
  afterDays: z.number().int().min(1).max(60),
  repeatDays: z.number().int().min(1).max(60),
});

/**
 * POST /api/organizations/reminder-settings — `{ afterDays, repeatDays }`: when Bystro
 * proposes reminders of overdue invoices. Owner and admin only. 204, or { error } with
 * 400, 401 or 403.
 */
export async function POST(request: Request) {
  const context = await requireApiContext();
  if (context instanceof Response) {
    return context;
  }
  if (!isSameOrigin(request, readAuthEnv().baseUrl)) {
    return json({ error: "forbidden" }, 403);
  }
  if (context.organization === null || context.role === null || !DECIDING_ROLES.has(context.role)) {
    return json({ error: "forbidden" }, 403);
  }
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return json({ error: "invalid" }, 400);
  }
  await setReminderSettings(getDb(), context.organization.id, body.data, {
    userId: context.user.id,
    source: "web",
  });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

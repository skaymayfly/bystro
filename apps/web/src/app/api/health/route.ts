import { pingDatabase } from "@bystro/db";

import { json } from "@/server/api";
import { getDb } from "@/server/db";
import { checkHealth } from "@/server/health";
import { pingRedis } from "@/server/redis";

// Always evaluated per request; a cached "ok" would defeat the purpose.
export const dynamic = "force-dynamic";

/**
 * GET /api/health — public, used by the hosting platform to decide whether a deploy is live.
 * 200 { status: "ok", database: "ok", redis: "ok" }
 * 503 { status: "down", database: "ok" | "down", redis: "ok" | "down" }
 */
export async function GET() {
  const report = await checkHealth({
    // A missing DATABASE_URL throws inside getDb(); that counts as "down" too.
    database: async () => pingDatabase(getDb()),
    redis: pingRedis,
  });
  return json(report, report.status === "ok" ? 200 : 503);
}

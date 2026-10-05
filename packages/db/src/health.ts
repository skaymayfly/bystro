import { sql } from "drizzle-orm";

import type { Db } from "./client";

/** Resolves `true` when the database answers a trivial query, `false` otherwise. Never throws. */
export async function pingDatabase(db: Db): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

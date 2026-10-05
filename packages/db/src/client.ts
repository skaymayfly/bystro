import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

/** Opens a connection pool and wraps it in Drizzle. Call `close()` when done. */
export function createDb(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle({ client: pool, schema });
  return { db, close: () => pool.end() };
}

export type DbConnection = ReturnType<typeof createDb>;
export type Db = DbConnection["db"];

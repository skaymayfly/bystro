import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Opens a connection pool and wraps it in Drizzle. Call `close()` when done.
 *
 * The schema is intentionally not attached: `db.query.<table>` would otherwise let callers
 * read tenant tables without importing them, bypassing `forOrganization`.
 */
export function createDb(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle({ client: pool });
  return { db, close: () => pool.end() };
}

export type DbConnection = ReturnType<typeof createDb>;
export type Db = DbConnection["db"];
export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Either the database itself or an open transaction. */
export type DbExecutor = Db | DbTransaction;

import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/** Arbitrary constant identifying "Bystro is migrating this database" for advisory locks. */
const MIGRATION_LOCK_ID = 4_815_162_342;

/**
 * Applies all pending migrations. Safe to run repeatedly and from several processes at
 * once (parallel test runners, several app instances starting together): a database-wide
 * advisory lock makes concurrent runs wait for each other instead of colliding.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  // One dedicated connection: the lock belongs to the session that runs the migrations.
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await migrate(drizzle({ client }), { migrationsFolder });
  } finally {
    // Closing the session releases the lock, also when a migration fails.
    await client.end();
  }
}

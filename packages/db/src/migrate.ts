import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDb } from "./client";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/** Applies all pending migrations. Safe to run repeatedly. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, close } = createDb(databaseUrl);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}

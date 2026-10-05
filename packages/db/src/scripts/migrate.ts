import { readDatabaseUrl } from "../env";
import { loadRootEnv } from "../load-env";
import { runMigrations } from "../migrate";

loadRootEnv();

try {
  await runMigrations(readDatabaseUrl());
  console.info("Migrations applied.");
} catch (error) {
  // Print only the error message: connection errors must not leak the connection string.
  console.error(`Migration failed: ${error instanceof Error ? error.message : "unknown error"}`);
  console.error("Is PostgreSQL running? Start it with `docker compose up -d`.");
  process.exitCode = 1;
}

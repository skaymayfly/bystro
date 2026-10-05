import { readDatabaseUrl } from "../env";
import { loadRootEnv } from "../load-env";
import { runMigrations } from "../migrate";

/**
 * Command-line entry for migrations.
 * - Locally: `pnpm db:migrate` reads the repository-root `.env`.
 * - Deployed: bundled into one file (`pnpm --filter @bystro/db build:migrate`) and run with
 *   MIGRATIONS_DIR pointing at the SQL files shipped in the image.
 */
async function main(): Promise<void> {
  const migrationsDir = process.env.MIGRATIONS_DIR?.trim();
  const deployed = migrationsDir !== undefined && migrationsDir !== "";
  if (!deployed) {
    loadRootEnv();
  }

  try {
    await runMigrations(readDatabaseUrl(), deployed ? migrationsDir : undefined);
    console.info("Migrations applied.");
  } catch (error) {
    // Print only the error message: connection errors must not leak the connection string.
    console.error(`Migration failed: ${error instanceof Error ? error.message : "unknown error"}`);
    if (!deployed) {
      console.error("Is PostgreSQL running? Start it with `docker compose up -d`.");
    }
    process.exitCode = 1;
  }
}

void main();

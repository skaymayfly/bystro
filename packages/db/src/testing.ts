/**
 * Helpers for integration and E2E tests in other workspace packages.
 * Everything here refuses to work with a database whose name does not end with `_test`.
 */
import { Client } from "pg";

import { loadRootEnv } from "./load-env";
import { runMigrations } from "./migrate";
import { readTestDatabase } from "./test/test-database";

export { loadRootEnv } from "./load-env";
export { readTestDatabase } from "./test/test-database";

/** SQLSTATE codes PostgreSQL reports when two sessions create the same database at once. */
const ALREADY_CREATED = new Set(["42P04", "23505"]);

/** Creates the database unless it exists. Safe when several processes do it at once. */
export async function ensureDatabaseExists(maintenanceUrl: string, name: string): Promise<void> {
  const client = new Client({ connectionString: maintenanceUrl });
  try {
    await client.connect();
  } catch {
    throw new Error(
      "Cannot reach PostgreSQL for integration tests. Start it with `docker compose up -d`.",
    );
  }
  try {
    const existing = await client.query("select 1 from pg_database where datname = $1", [name]);
    if (existing.rowCount === 0) {
      // Callers validate `name` against /^[a-z0-9_]+_test$/, so it is safe as an identifier.
      await client.query(`create database "${name}"`);
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === undefined || !ALREADY_CREATED.has(code)) {
      throw error;
    }
  } finally {
    await client.end();
  }
}

/**
 * Creates the test database if needed and migrates it. Returns its connection string.
 * Safe to call repeatedly and from several test runners at the same time.
 */
export async function prepareTestDatabase(): Promise<string> {
  loadRootEnv();
  const { url, name } = readTestDatabase();

  const maintenanceUrl = new URL(url);
  maintenanceUrl.pathname = "/postgres";
  await ensureDatabaseExists(maintenanceUrl.toString(), name);

  await runMigrations(url);
  return url;
}

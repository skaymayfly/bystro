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

/**
 * Creates the test database if needed and migrates it. Returns its connection string.
 * Safe to call repeatedly and from several test runners.
 */
export async function prepareTestDatabase(): Promise<string> {
  loadRootEnv();
  const { url, name } = readTestDatabase();

  const maintenanceUrl = new URL(url);
  maintenanceUrl.pathname = "/postgres";
  const client = new Client({ connectionString: maintenanceUrl.toString() });
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
      // `name` is validated against /^[a-z0-9_]+_test$/, so it is safe as an identifier.
      await client.query(`create database "${name}"`);
    }
  } finally {
    await client.end();
  }

  await runMigrations(url);
  return url;
}

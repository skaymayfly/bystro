import { Client } from "pg";

import { loadRootEnv } from "../load-env";
import { runMigrations } from "../migrate";
import { readTestDatabase } from "./test-database";

/** Creates the test database if needed and migrates it before any test runs. */
export default async function setup(): Promise<void> {
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
}

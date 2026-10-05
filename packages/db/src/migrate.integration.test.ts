import { randomBytes } from "node:crypto";

import { Client } from "pg";
import { describe, expect, it } from "vitest";

import { runMigrations } from "./migrate";
import { readTestDatabase } from "./test/test-database";
import { ensureDatabaseExists } from "./testing";

/** Connection strings for a brand-new, empty database next to the shared test database. */
function freshDatabase() {
  const name = `bystro_race_${randomBytes(6).toString("hex")}_test`;
  const url = new URL(readTestDatabase().url);
  url.pathname = `/${name}`;
  const maintenance = new URL(url);
  maintenance.pathname = "/postgres";
  return { name, url: url.toString(), maintenanceUrl: maintenance.toString() };
}

async function query<T extends Record<string, unknown>>(url: string, sql: string): Promise<T[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(sql)).rows;
  } finally {
    await client.end();
  }
}

describe("migrations under concurrency", () => {
  it("several processes can create and migrate an empty database at the same time", async () => {
    const database = freshDatabase();
    try {
      // What parallel test runners do on a clean CI machine.
      await Promise.all(
        Array.from({ length: 4 }, () =>
          ensureDatabaseExists(database.maintenanceUrl, database.name),
        ),
      );
      await Promise.all(Array.from({ length: 4 }, () => runMigrations(database.url)));

      const [applied] = await query<{ count: number }>(
        database.url,
        "select count(*)::int as count from drizzle.__drizzle_migrations",
      );
      const tables = await query<{ tablename: string }>(
        database.url,
        "select tablename from pg_tables where schemaname = 'public' order by tablename",
      );

      // Each migration is recorded exactly once, however many runners raced.
      expect(applied?.count).toBe(1);
      expect(tables.map((row) => row.tablename)).toContain("organizations");
    } finally {
      // The database was created by this test and its name ends with `_test`.
      await query(database.maintenanceUrl, `drop database if exists "${database.name}"`);
    }
  }, 30_000);
});

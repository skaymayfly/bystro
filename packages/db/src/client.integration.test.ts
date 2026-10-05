import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { createDb } from "./client";
import { runMigrations } from "./migrate";
import { readTestDatabase } from "./test/test-database";

const testDatabase = readTestDatabase();
const { db, close } = createDb(testDatabase.url);

afterAll(async () => {
  await close();
});

async function appliedMigrationCount(): Promise<number> {
  const result = await db.execute(
    sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
  );
  return Number(result.rows[0]?.count);
}

describe("database (integration)", () => {
  it("connects to the test database", async () => {
    const result = await db.execute(sql`select current_database() as name`);
    expect(result.rows[0]?.name).toBe(testDatabase.name);
  });

  it("has the migration bookkeeping table after setup", async () => {
    const result = await db.execute(
      sql`select to_regclass('drizzle.__drizzle_migrations')::text as name`,
    );
    expect(result.rows[0]?.name).toBe("drizzle.__drizzle_migrations");
  });

  it("running migrations again changes nothing", async () => {
    const before = await appliedMigrationCount();
    await runMigrations(testDatabase.url);
    await runMigrations(testDatabase.url);
    expect(await appliedMigrationCount()).toBe(before);
  });
});

import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as publicApi from "./index";
import * as authTables from "./schema/auth";
import * as integrationTables from "./schema/integrations";
import * as organizationTables from "./schema/tenant";

/** Every table holding data of one organization. */
const tenantTables = { ...organizationTables, ...integrationTables };

// Module namespace objects have a null prototype, which Drizzle's `is` cannot handle.
function isTable(value: unknown): value is PgTable {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) !== null &&
    is(value, PgTable)
  );
}

function tableNames(module: Record<string, unknown>): string[] {
  return Object.values(module)
    .filter(isTable)
    .map((table) => getTableName(table))
    .sort();
}

/** Collects every Drizzle table reachable from the package's public exports. */
function exportedTableNames(): string[] {
  const names = new Set<string>();
  for (const value of Object.values(publicApi)) {
    if (isTable(value)) {
      names.add(getTableName(value));
    } else if (typeof value === "object" && value !== null) {
      for (const name of tableNames(value as Record<string, unknown>)) {
        names.add(name);
      }
    }
  }
  return [...names].sort();
}

describe("public API of @bystro/db", () => {
  it("has tenant tables to protect (guards against this test going stale)", () => {
    expect(tableNames(tenantTables)).toEqual([
      "audit_logs",
      "integration_connections",
      "integration_credentials",
      "memberships",
      "oauth_requests",
      "organizations",
      "sync_cursors",
      "webhook_events",
    ]);
  });

  it("exports no tenant table, so tenant data cannot be queried without an organizationId", () => {
    const exported = exportedTableNames();
    for (const name of tableNames(tenantTables)) {
      expect(exported).not.toContain(name);
    }
  });

  it("exports exactly the Better Auth tables", () => {
    expect(exportedTableNames()).toEqual(tableNames(authTables));
    expect(tableNames(authTables)).toEqual(["accounts", "sessions", "users", "verifications"]);
  });

  it("a database handle has no relational query shortcuts to tenant tables", async () => {
    const { db, close } = publicApi.createDb("postgresql://unused:unused@localhost:1/unused");
    expect(Object.keys(db.query)).toEqual([]);
    await close();
  });

  it("does not export the raw schema or a ready-made database connection", () => {
    expect(Object.keys(publicApi)).not.toContain("schema");
    expect(Object.keys(publicApi)).not.toContain("db");
  });
});

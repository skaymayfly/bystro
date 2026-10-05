import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { EnvError, readDatabaseUrl, readEncryptionKey } from "./env";
import { readTestDatabase } from "./test/test-database";

describe("readDatabaseUrl", () => {
  it("returns a valid connection string", () => {
    const url = "postgresql://user:pass@localhost:5432/bystro";
    expect(readDatabaseUrl({ DATABASE_URL: url })).toBe(url);
    expect(readDatabaseUrl({ OTHER: "postgres://u:p@db/x" }, "OTHER")).toBe("postgres://u:p@db/x");
  });

  it("fails when the variable is missing or empty", () => {
    expect(() => readDatabaseUrl({})).toThrow(EnvError);
    expect(() => readDatabaseUrl({ DATABASE_URL: "" })).toThrow(/DATABASE_URL is not set/);
  });

  it("fails on a non-postgres URL without echoing the value", () => {
    const secretUrl = "mysql://user:hunter2@localhost/db";
    try {
      readDatabaseUrl({ DATABASE_URL: secretUrl });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      expect((error as Error).message).not.toContain("hunter2");
    }
  });
});

describe("readEncryptionKey", () => {
  it("returns the decoded 32-byte key", () => {
    const key = randomBytes(32);
    expect(readEncryptionKey({ ENCRYPTION_KEY: key.toString("base64") }).equals(key)).toBe(true);
  });

  it("fails when the key is missing", () => {
    expect(() => readEncryptionKey({})).toThrow(/ENCRYPTION_KEY is not set/);
  });

  it("fails on a key of the wrong length without echoing the value", () => {
    const badKey = randomBytes(8).toString("base64");
    try {
      readEncryptionKey({ ENCRYPTION_KEY: badKey });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      expect((error as Error).message).not.toContain(badKey);
    }
  });
});

describe("readTestDatabase", () => {
  it("accepts a database whose name ends with _test", () => {
    const url = "postgresql://u:p@localhost:5432/bystro_test";
    expect(readTestDatabase({ DATABASE_URL_TEST: url })).toEqual({ url, name: "bystro_test" });
  });

  it("refuses any other database name", () => {
    for (const name of ["bystro", "bystro_test_backup", "Bystro_test", 'x";drop_test']) {
      const url = `postgresql://u:p@localhost:5432/${encodeURIComponent(name)}`;
      expect(() => readTestDatabase({ DATABASE_URL_TEST: url })).toThrow(/_test/);
    }
  });
});

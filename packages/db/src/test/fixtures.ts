import { randomUUID } from "node:crypto";

import { expect } from "vitest";

import type { Db } from "../client";
import { createOrganization } from "../organizations";
import { users } from "../schema";

/** Inserts a user with a unique e-mail. Tests never clean up: every test uses fresh rows. */
export async function createTestUser(db: Db, name = "Test User"): Promise<{ id: string }> {
  const [user] = await db
    .insert(users)
    .values({ name, email: `user-${randomUUID()}@example.test` })
    .returning({ id: users.id });
  if (user === undefined) {
    throw new Error("User insert returned no row.");
  }
  return user;
}

/** Creates a user and an organization owned by them. */
export async function createTestOrganization(db: Db, name: string, ico = "27074358") {
  const owner = await createTestUser(db, `Owner of ${name}`);
  const organization = await createOrganization(db, {
    organization: { name, ico },
    ownerUserId: owner.id,
    source: "web",
  });
  return { owner, organization };
}

/** Asserts that the promise rejects with the given PostgreSQL error code (SQLSTATE). */
export async function expectPgError(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, "expected the query to fail").toBeInstanceOf(Error);
  // Drizzle wraps driver errors; the pg error with the SQLSTATE code is the cause.
  const pgError = (caught as { cause?: { code?: string } }).cause ?? (caught as { code?: string });
  expect(pgError.code).toBe(code);
}

export const PG_UNIQUE_VIOLATION = "23505";
export const PG_CHECK_VIOLATION = "23514";
export const PG_FOREIGN_KEY_VIOLATION = "23503";
export const PG_INVALID_ENUM_VALUE = "22P02";

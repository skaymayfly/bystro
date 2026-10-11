import { expect } from "vitest";

export { createTestOrganization, createTestUser } from "./organization-fixtures";

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

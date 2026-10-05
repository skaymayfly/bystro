import { readDatabaseUrl } from "../env";

const TEST_DATABASE_NAME = /^[a-z0-9_]+_test$/;

/**
 * Returns the test database URL and its database name.
 * Refuses anything whose name does not end with `_test`, so tests can never touch real data.
 */
export function readTestDatabase(env: Record<string, string | undefined> = process.env) {
  const url = readDatabaseUrl(env, "DATABASE_URL_TEST");
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!TEST_DATABASE_NAME.test(name)) {
    throw new Error(
      'DATABASE_URL_TEST must point to a database whose name ends with "_test" (lowercase letters, digits, underscores).',
    );
  }
  return { url, name };
}

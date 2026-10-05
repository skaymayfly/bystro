import { createDb, readDatabaseUrl, type Db } from "@bystro/db";

// Kept on globalThis so that dev-mode hot reloads reuse one connection pool.
const globalForDb = globalThis as typeof globalThis & { __bystroDb?: Db };

/** The web app's database handle, created on first use. */
export function getDb(): Db {
  globalForDb.__bystroDb ??= createDb(readDatabaseUrl()).db;
  return globalForDb.__bystroDb;
}

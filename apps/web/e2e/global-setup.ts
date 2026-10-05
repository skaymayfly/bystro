import { prepareTestDatabase } from "@bystro/db/testing";

/** Creates and migrates the test database before the web server starts serving tests. */
export default async function globalSetup(): Promise<void> {
  await prepareTestDatabase();
}

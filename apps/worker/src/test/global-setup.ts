import { prepareTestDatabase } from "@bystro/db/testing";

/** Creates and migrates the test database before the tests that sync into it run. */
export default async function setup(): Promise<void> {
  await prepareTestDatabase();
}

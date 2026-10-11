import { prepareTestDatabase } from "@bystro/db/testing";

/** Creates and migrates the test database before integration tests run. */
export default async function setup(): Promise<void> {
  await prepareTestDatabase();
}

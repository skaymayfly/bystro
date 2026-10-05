import { prepareTestDatabase } from "../testing";

/** Creates the test database if needed and migrates it before any test runs. */
export default async function setup(): Promise<void> {
  await prepareTestDatabase();
}

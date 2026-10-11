import { randomUUID } from "node:crypto";

import type { Db } from "../client";
import { createOrganization } from "../organizations";
import { users } from "../schema";

/*
 * Rows that tests in any workspace package need before they can touch tenant data.
 * No test framework is imported here, so E2E helpers can use this file too.
 */

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

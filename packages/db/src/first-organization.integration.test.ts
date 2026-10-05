import { afterAll, describe, expect, it } from "vitest";

import { createDb } from "./client";
import {
  createFirstOrganization,
  listOrganizationsForUser,
  OrganizationAlreadyExistsError,
} from "./organizations";
import { forOrganization } from "./tenant";
import { createTestUser } from "./test/fixtures";
import { readTestDatabase } from "./test/test-database";

const { db, close } = createDb(readTestDatabase().url);

afterAll(async () => {
  await close();
});

const input = (ownerUserId: string, name = "Dvořák Interiéry s.r.o.") => ({
  organization: { name, ico: "27074358", dic: "CZ27074358", vatPayer: true },
  ownerUserId,
  source: "web" as const,
});

describe("createFirstOrganization", () => {
  it("creates the organization with its owner and audit record", async () => {
    const user = await createTestUser(db);

    const organization = await createFirstOrganization(db, input(user.id));

    const scope = forOrganization(db, organization.id);
    expect(await scope.getOrganization()).toMatchObject({
      name: "Dvořák Interiéry s.r.o.",
      ico: "27074358",
      dic: "CZ27074358",
      vatPayer: true,
    });
    expect((await scope.getMembership(user.id))?.role).toBe("owner");
    expect((await scope.listAuditLogs()).map((log) => log.action)).toEqual([
      "organization.created",
    ]);
  });

  it("refuses a second organization for the same user and stores nothing", async () => {
    const user = await createTestUser(db);
    const first = await createFirstOrganization(db, input(user.id));

    await expect(createFirstOrganization(db, input(user.id, "Druhá firma"))).rejects.toThrow(
      OrganizationAlreadyExistsError,
    );

    const organizations = await listOrganizationsForUser(db, user.id);
    expect(organizations.map((row) => row.organization.id)).toEqual([first.id]);
  });

  it("creates exactly one organization when the form is submitted several times at once", async () => {
    const user = await createTestUser(db);

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) =>
        createFirstOrganization(db, input(user.id, `Souběh ${index}`)),
      ),
    );

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const result of rejected) {
      expect(result.reason).toBeInstanceOf(OrganizationAlreadyExistsError);
    }
    expect(await listOrganizationsForUser(db, user.id)).toHaveLength(1);
  });

  it("does not block or affect other users", async () => {
    const [a, b] = await Promise.all([createTestUser(db), createTestUser(db)]);

    const [orgA, orgB] = await Promise.all([
      createFirstOrganization(db, input(a.id, "Firma A")),
      createFirstOrganization(db, input(b.id, "Firma B")),
    ]);

    expect(orgA.id).not.toBe(orgB.id);
    expect((await listOrganizationsForUser(db, a.id)).map((r) => r.organization.name)).toEqual([
      "Firma A",
    ]);
    expect((await listOrganizationsForUser(db, b.id)).map((r) => r.organization.name)).toEqual([
      "Firma B",
    ]);
  });
});

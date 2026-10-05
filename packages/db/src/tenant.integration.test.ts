import { randomUUID } from "node:crypto";

import { REDACTED } from "@bystro/core";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { createDb } from "./client";
import { InvalidIdError } from "./ids";
import { createOrganization, listOrganizationsForUser } from "./organizations";
import { auditLogs, memberships, organizations } from "./schema";
import { forOrganization } from "./tenant";
import {
  createTestOrganization,
  createTestUser,
  expectPgError,
  PG_CHECK_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  PG_INVALID_ENUM_VALUE,
  PG_UNIQUE_VIOLATION,
} from "./test/fixtures";
import { readTestDatabase } from "./test/test-database";

const { db, close } = createDb(readTestDatabase().url);

afterAll(async () => {
  await close();
});

describe("tenant isolation", () => {
  it("organization A cannot see the organization, members or audit log of B, and vice versa", async () => {
    const a = await createTestOrganization(db, "Firma A", "27074358");
    const b = await createTestOrganization(db, "Firma B", "45274649");
    const scopeA = forOrganization(db, a.organization.id);
    const scopeB = forOrganization(db, b.organization.id);
    await scopeA.writeAudit({
      actor: { type: "system" },
      action: "test.only_a",
      target: { type: "test" },
      source: "worker",
    });
    await scopeB.writeAudit({
      actor: { type: "system" },
      action: "test.only_b",
      target: { type: "test" },
      source: "worker",
    });

    expect((await scopeA.getOrganization())?.name).toBe("Firma A");
    expect((await scopeB.getOrganization())?.name).toBe("Firma B");

    const membersA = await scopeA.listMemberships();
    const membersB = await scopeB.listMemberships();
    expect(membersA.map((m) => m.userId)).toEqual([a.owner.id]);
    expect(membersB.map((m) => m.userId)).toEqual([b.owner.id]);

    const auditA = await scopeA.listAuditLogs();
    const auditB = await scopeB.listAuditLogs();
    expect(auditA.map((log) => log.action).sort()).toEqual(["organization.created", "test.only_a"]);
    expect(auditB.map((log) => log.action).sort()).toEqual(["organization.created", "test.only_b"]);
    expect(auditA.every((log) => log.organizationId === a.organization.id)).toBe(true);
    expect(auditB.every((log) => log.organizationId === b.organization.id)).toBe(true);
  });

  it("a member of A is not a member of B", async () => {
    const a = await createTestOrganization(db, "Firma A");
    const b = await createTestOrganization(db, "Firma B");

    expect((await forOrganization(db, a.organization.id).getMembership(a.owner.id))?.role).toBe(
      "owner",
    );
    expect(await forOrganization(db, b.organization.id).getMembership(a.owner.id)).toBeNull();
    expect(await forOrganization(db, a.organization.id).getMembership(b.owner.id)).toBeNull();
  });

  it("a user only lists the organizations they belong to", async () => {
    const a = await createTestOrganization(db, "Firma A");
    const b = await createTestOrganization(db, "Firma B");
    const outsider = await createTestUser(db);

    const forA = await listOrganizationsForUser(db, a.owner.id);
    expect(forA.map((row) => [row.organization.id, row.role])).toEqual([
      [a.organization.id, "owner"],
    ]);
    expect((await listOrganizationsForUser(db, b.owner.id)).map((r) => r.organization.id)).toEqual([
      b.organization.id,
    ]);
    expect(await listOrganizationsForUser(db, outsider.id)).toEqual([]);
  });

  it("an unknown organization yields nothing rather than someone else's data", async () => {
    await createTestOrganization(db, "Firma A");
    const scope = forOrganization(db, randomUUID());

    expect(await scope.getOrganization()).toBeNull();
    expect(await scope.listMemberships()).toEqual([]);
    expect(await scope.listAuditLogs()).toEqual([]);
  });

  it("refuses to build a scope without a valid organization id", () => {
    for (const bad of ["", "not-a-uuid", "1 or 1=1", undefined, null]) {
      expect(() => forOrganization(db, bad as string)).toThrow(InvalidIdError);
    }
  });
});

describe("createOrganization", () => {
  it("stores the organization, the owner membership and an audit record", async () => {
    const owner = await createTestUser(db);
    const organization = await createOrganization(db, {
      organization: {
        name: "Dvořák Interiéry s.r.o.",
        ico: "27074358",
        dic: "CZ27074358",
        street: "Dlouhá 12",
        city: "Praha",
        postalCode: "11000",
        vatPayer: true,
      },
      ownerUserId: owner.id,
      source: "web",
    });
    const scope = forOrganization(db, organization.id);

    expect(await scope.getOrganization()).toMatchObject({
      name: "Dvořák Interiéry s.r.o.",
      ico: "27074358",
      dic: "CZ27074358",
      country: "CZ",
      vatPayer: true,
    });
    expect(await scope.listMemberships()).toMatchObject([{ userId: owner.id, role: "owner" }]);
    expect(await scope.listAuditLogs()).toMatchObject([
      {
        action: "organization.created",
        actorType: "user",
        actorUserId: owner.id,
        targetType: "organization",
        targetId: organization.id,
        source: "web",
        result: "success",
        metadata: {},
      },
    ]);
  });

  it("stores nothing when the owner does not exist", async () => {
    const name = `Rollback ${randomUUID()}`;
    await expectPgError(
      createOrganization(db, {
        organization: { name, ico: "27074358" },
        ownerUserId: randomUUID(),
        source: "web",
      }),
      PG_FOREIGN_KEY_VIOLATION,
    );

    expect(await db.select().from(organizations).where(eq(organizations.name, name))).toEqual([]);
  });

  it("rejects an IČO that is not exactly 8 digits", async () => {
    const owner = await createTestUser(db);
    for (const ico of ["1234567", "123456789", "1234567a", ""]) {
      await expectPgError(
        createOrganization(db, {
          organization: { name: "Špatné IČO", ico },
          ownerUserId: owner.id,
          source: "web",
        }),
        PG_CHECK_VIOLATION,
      );
    }
  });

  it("allows two organizations with the same IČO", async () => {
    const first = await createTestOrganization(db, "První", "27074358");
    const second = await createTestOrganization(db, "Druhá", "27074358");
    expect(first.organization.id).not.toBe(second.organization.id);
  });
});

describe("memberships", () => {
  it("a user cannot be a member of the same organization twice", async () => {
    const { organization, owner } = await createTestOrganization(db, "Firma A");
    await expectPgError(
      db
        .insert(memberships)
        .values({ organizationId: organization.id, userId: owner.id, role: "member" }),
      PG_UNIQUE_VIOLATION,
    );
  });

  it("the same user can belong to several organizations with different roles", async () => {
    const a = await createTestOrganization(db, "Firma A");
    const b = await createTestOrganization(db, "Firma B");
    await db
      .insert(memberships)
      .values({ organizationId: b.organization.id, userId: a.owner.id, role: "member" });

    const rows = await listOrganizationsForUser(db, a.owner.id);
    expect(rows.map((row) => [row.organization.id, row.role])).toEqual([
      [a.organization.id, "owner"],
      [b.organization.id, "member"],
    ]);
  });

  it("rejects a role outside owner / admin / member", async () => {
    const { organization } = await createTestOrganization(db, "Firma A");
    const user = await createTestUser(db);
    await expectPgError(
      db
        .insert(memberships)
        .values({ organizationId: organization.id, userId: user.id, role: "superuser" as "owner" }),
      PG_INVALID_ENUM_VALUE,
    );
  });
});

describe("audit log", () => {
  it("never stores sensitive metadata values", async () => {
    const { organization, owner } = await createTestOrganization(db, "Firma A");
    const scope = forOrganization(db, organization.id);
    await scope.writeAudit({
      actor: { type: "user", userId: owner.id },
      action: "integration.connected",
      target: { type: "integration", id: "fakturoid" },
      source: "web",
      metadata: {
        provider: "fakturoid",
        accessToken: "secret-access-token",
        account: { email: "majitel@example.cz", iban: "CZ6508000000192000145399" },
      },
    });

    const [stored] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, organization.id))
      .then((rows) => rows.filter((row) => row.action === "integration.connected"));
    expect(stored?.metadata).toEqual({
      provider: "fakturoid",
      accessToken: REDACTED,
      account: { email: REDACTED, iban: REDACTED },
    });
    const raw = JSON.stringify(stored);
    expect(raw).not.toContain("secret-access-token");
    expect(raw).not.toContain("majitel@example.cz");
    expect(raw).not.toContain("CZ6508000000192000145399");
  });

  it("records failures and system actors", async () => {
    const { organization } = await createTestOrganization(db, "Firma A");
    const scope = forOrganization(db, organization.id);
    await scope.writeAudit({
      actor: { type: "system" },
      action: "sync.run",
      target: { type: "integration" },
      source: "worker",
      result: "failure",
      metadata: { reason: "timeout" },
    });

    expect((await scope.listAuditLogs({ limit: 1 }))[0]).toMatchObject({
      action: "sync.run",
      actorType: "system",
      actorUserId: null,
      targetId: null,
      result: "failure",
      metadata: { reason: "timeout" },
    });
  });

  it("a user actor must carry a user id", async () => {
    const { organization } = await createTestOrganization(db, "Firma A");
    await expectPgError(
      db.insert(auditLogs).values({
        organizationId: organization.id,
        actorType: "user",
        action: "test.no_actor",
        targetType: "test",
        source: "web",
        result: "success",
      }),
      PG_CHECK_VIOLATION,
    );
  });

  it("returns the newest records first and respects the limit", async () => {
    const { organization } = await createTestOrganization(db, "Firma A");
    const scope = forOrganization(db, organization.id);
    for (const action of ["test.first", "test.second", "test.third"]) {
      await scope.writeAudit({
        actor: { type: "system" },
        action,
        target: { type: "test" },
        source: "worker",
      });
    }

    const logs = await scope.listAuditLogs({ limit: 2 });
    expect(logs.map((log) => log.action)).toEqual(["test.third", "test.second"]);
  });
});

import type { AuditSource, Role } from "@bystro/core";
import { asc, eq } from "drizzle-orm";

import { writeAudit } from "./audit";
import type { Db } from "./client";
import { requireUuid } from "./ids";
import { memberships, organizations } from "./schema";

export type Organization = typeof organizations.$inferSelect;
export type Membership = typeof memberships.$inferSelect;

export interface NewOrganization {
  name: string;
  /** Czech company ID, 8 digits. */
  ico: string;
  dic?: string | null;
  street?: string | null;
  city?: string | null;
  postalCode?: string | null;
  /** ISO 3166-1 alpha-2; defaults to "CZ". */
  country?: string;
  vatPayer?: boolean;
}

/**
 * Creates an organization, makes the given user its owner and writes the audit record,
 * all in one transaction: either everything is stored or nothing is.
 */
export async function createOrganization(
  db: Db,
  input: { organization: NewOrganization; ownerUserId: string; source: AuditSource },
): Promise<Organization> {
  const ownerUserId = requireUuid(input.ownerUserId, "ownerUserId");
  const { organization: data } = input;

  return db.transaction(async (tx) => {
    const [organization] = await tx
      .insert(organizations)
      .values({
        name: data.name,
        ico: data.ico,
        dic: data.dic ?? null,
        street: data.street ?? null,
        city: data.city ?? null,
        postalCode: data.postalCode ?? null,
        ...(data.country === undefined ? {} : { country: data.country }),
        vatPayer: data.vatPayer ?? false,
      })
      .returning();
    if (organization === undefined) {
      throw new Error("Organization insert returned no row.");
    }

    await tx
      .insert(memberships)
      .values({ organizationId: organization.id, userId: ownerUserId, role: "owner" });

    await writeAudit(tx, organization.id, {
      actor: { type: "user", userId: ownerUserId },
      action: "organization.created",
      target: { type: "organization", id: organization.id },
      source: input.source,
    });

    return organization;
  });
}

/**
 * Lists the organizations a user belongs to, with their role, oldest membership first.
 * Scoped by user, not by tenant: this is how the active organization gets chosen.
 */
export async function listOrganizationsForUser(
  db: Db,
  userId: string,
): Promise<{ organization: Organization; role: Role }[]> {
  return db
    .select({ organization: organizations, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(eq(memberships.userId, requireUuid(userId, "userId")))
    .orderBy(asc(memberships.createdAt), asc(memberships.id));
}

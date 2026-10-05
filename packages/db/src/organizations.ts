import type { AuditSource, Role } from "@bystro/core";
import { asc, eq, sql } from "drizzle-orm";

import { writeAudit } from "./audit";
import type { Db, DbTransaction } from "./client";
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

export interface CreateOrganizationInput {
  organization: NewOrganization;
  ownerUserId: string;
  source: AuditSource;
}

/** Thrown by {@link createFirstOrganization} when the user already belongs to an organization. */
export class OrganizationAlreadyExistsError extends Error {
  override name = "OrganizationAlreadyExistsError";
}

/** Inserts the organization, its owner membership and the audit record inside `tx`. */
async function insertOrganizationWithOwner(
  tx: DbTransaction,
  ownerUserId: string,
  input: CreateOrganizationInput,
): Promise<Organization> {
  const { organization: data } = input;
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
}

/**
 * Creates an organization, makes the given user its owner and writes the audit record,
 * all in one transaction: either everything is stored or nothing is.
 */
export async function createOrganization(
  db: Db,
  input: CreateOrganizationInput,
): Promise<Organization> {
  const ownerUserId = requireUuid(input.ownerUserId, "ownerUserId");
  return db.transaction((tx) => insertOrganizationWithOwner(tx, ownerUserId, input));
}

/**
 * Creates the user's first organization (onboarding). Idempotent against double submits:
 * a per-user lock makes concurrent calls run one after another, and every call after the
 * first throws {@link OrganizationAlreadyExistsError} instead of creating a duplicate.
 */
export async function createFirstOrganization(
  db: Db,
  input: CreateOrganizationInput,
): Promise<Organization> {
  const ownerUserId = requireUuid(input.ownerUserId, "ownerUserId");

  return db.transaction(async (tx) => {
    // Held until the transaction ends; keyed by user, so other users are not blocked.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ownerUserId}, 0))`);

    const [existing] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.userId, ownerUserId))
      .limit(1);
    if (existing !== undefined) {
      throw new OrganizationAlreadyExistsError("The user already belongs to an organization.");
    }

    return insertOrganizationWithOwner(tx, ownerUserId, input);
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

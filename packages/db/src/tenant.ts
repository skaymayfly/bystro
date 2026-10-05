import { and, asc, desc, eq } from "drizzle-orm";

import { writeAudit, type AuditEntry } from "./audit";
import type { Db } from "./client";
import { requireUuid } from "./ids";
import type { Membership, Organization } from "./organizations";
import { auditLogs, memberships, organizations } from "./schema";

export type AuditLog = typeof auditLogs.$inferSelect;

const AUDIT_LIST_DEFAULT_LIMIT = 50;
const AUDIT_LIST_MAX_LIMIT = 200;

/**
 * The only way to reach tenant data: every query made through the returned object
 * is filtered by `organizationId`. Throws if `organizationId` is not a UUID.
 *
 * This does not check that the current user may access the organization; callers
 * establish that first with `getMembership(userId)`.
 */
export function forOrganization(db: Db, organizationId: string) {
  const orgId = requireUuid(organizationId, "organizationId");

  return {
    organizationId: orgId,

    async getOrganization(): Promise<Organization | null> {
      const [row] = await db.select().from(organizations).where(eq(organizations.id, orgId));
      return row ?? null;
    },

    async listMemberships(): Promise<Membership[]> {
      return db
        .select()
        .from(memberships)
        .where(eq(memberships.organizationId, orgId))
        .orderBy(asc(memberships.createdAt), asc(memberships.id));
    },

    /** The user's membership in this organization, or null if they are not a member. */
    async getMembership(userId: string): Promise<Membership | null> {
      const [row] = await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, orgId),
            eq(memberships.userId, requireUuid(userId, "userId")),
          ),
        );
      return row ?? null;
    },

    async writeAudit(entry: AuditEntry): Promise<void> {
      await writeAudit(db, orgId, entry);
    },

    /** Newest first. */
    async listAuditLogs(options: { limit?: number } = {}): Promise<AuditLog[]> {
      const limit = Math.min(
        Math.max(1, Math.trunc(options.limit ?? AUDIT_LIST_DEFAULT_LIMIT)),
        AUDIT_LIST_MAX_LIMIT,
      );
      return db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.organizationId, orgId))
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(limit);
    },
  };
}

export type OrganizationScope = ReturnType<typeof forOrganization>;

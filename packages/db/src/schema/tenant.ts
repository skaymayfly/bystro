/**
 * Tenant data: everything that belongs to one organization.
 * These tables are never exported from the package; access goes through `forOrganization`.
 */
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_RESULTS,
  AUDIT_SOURCES,
  ROLES,
  type JsonValue,
} from "@bystro/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const id = () =>
  uuid("id")
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey();

export const membershipRole = pgEnum("membership_role", ROLES);
export const auditActorType = pgEnum("audit_actor_type", AUDIT_ACTOR_TYPES);
export const auditSource = pgEnum("audit_source", AUDIT_SOURCES);
export const auditResult = pgEnum("audit_result", AUDIT_RESULTS);

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    name: text("name").notNull(),
    /** Czech company ID (IČO). Deliberately not unique: ownership of an IČO is not verified. */
    ico: text("ico").notNull(),
    /** VAT ID (DIČ), e.g. "CZ12345678". */
    dic: text("dic"),
    street: text("street"),
    city: text("city"),
    postalCode: text("postal_code"),
    /** ISO 3166-1 alpha-2. */
    country: text("country").notNull().default("CZ"),
    vatPayer: boolean("vat_payer").notNull().default(false),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check("organizations_ico_format", sql`${table.ico} ~ '^[0-9]{8}$'`),
    check("organizations_country_format", sql`${table.country} ~ '^[A-Z]{2}$'`),
    index("organizations_ico_idx").on(table.ico),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: membershipRole("role").notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("memberships_organization_user_unique").on(table.organizationId, table.userId),
    index("memberships_user_id_idx").on(table.userId),
  ],
);

/** Append-only: the data layer offers insert and read, never update or delete. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    actorType: auditActorType("actor_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    /** What happened, as `<object>.<verb>`, e.g. "organization.created". */
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    source: auditSource("source").notNull(),
    result: auditResult("result").notNull(),
    /** Sanitized by `sanitizeAuditMetadata` before insert; never holds sensitive values. */
    metadata: jsonb("metadata").$type<{ [key: string]: JsonValue }>().notNull().default({}),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
  },
  (table) => [
    check(
      "audit_logs_user_actor_has_id",
      sql`${table.actorType} <> 'user' or ${table.actorUserId} is not null`,
    ),
    index("audit_logs_organization_created_idx").on(table.organizationId, table.createdAt),
  ],
);

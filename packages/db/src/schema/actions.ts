/**
 * Actions Bystro proposes and carries out, and the user's decisions about them. Tenant data:
 * never exported from the package; access goes through the functions in `../actions.ts`,
 * which all take an `organizationId`.
 *
 * Approvals reference their action together with `organization_id` (composite foreign key),
 * so the database itself refuses a decision about another organization's action.
 */
import {
  ACTION_APPROVAL_LEVELS,
  ACTION_STATUSES,
  ACTION_TYPES,
  APPROVAL_DECISIONS,
  type JsonValue,
} from "@bystro/core";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
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
import { auditActorType, organizations } from "./tenant";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const id = () =>
  uuid("id")
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey();

export const actionType = pgEnum("action_type", ACTION_TYPES);
export const actionStatus = pgEnum("action_status", ACTION_STATUSES);
export const actionApprovalLevel = pgEnum("action_approval_level", ACTION_APPROVAL_LEVELS);
export const approvalDecision = pgEnum("approval_decision", APPROVAL_DECISIONS);

/** A reference to the data an action is about, e.g. `{ type: "invoice", id: "…" }`. */
export interface ActionSourceRef {
  type: string;
  id: string;
}

export const actions = pgTable(
  "actions",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    type: actionType("type").notNull(),
    status: actionStatus("status").notNull().default("proposed"),
    /** Why it exists, as a code, e.g. "invoice_overdue". */
    triggerCode: text("trigger_code").notNull(),
    /** Details of the trigger (e.g. days overdue). No secrets. */
    triggerData: jsonb("trigger_data").$type<{ [key: string]: JsonValue }>().notNull().default({}),
    /** The data it is about. */
    sources: jsonb("sources").$type<ActionSourceRef[]>().notNull().default([]),
    /** What will happen, as the user sees it before deciding (e.g. recipient and text). */
    preview: jsonb("preview").$type<{ [key: string]: JsonValue }>().notNull().default({}),
    approvalLevel: actionApprovalLevel("approval_level").notNull(),
    /** From this moment on it may no longer be approved or started. */
    expiresAt: timestamptz("expires_at"),
    /** The same key never creates a second action in the organization. */
    idempotencyKey: text("idempotency_key").notNull(),
    proposedByType: auditActorType("proposed_by_type").notNull(),
    proposedByUserId: uuid("proposed_by_user_id").references(() => users.id),
    /** What carrying it out produced, e.g. the id of the sent message. */
    resultReference: text("result_reference"),
    /** Short machine code of the failure; never a provider message. */
    errorCode: text("error_code"),
    statusChangedAt: timestamptz("status_changed_at").defaultNow().notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("actions_organization_idempotency_key_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    // Target of the composite foreign key of approvals.
    unique("actions_organization_id_unique").on(table.organizationId, table.id),
    index("actions_organization_status_idx").on(table.organizationId, table.status),
    check(
      "actions_user_proposer_has_id",
      sql`${table.proposedByType} <> 'user' or ${table.proposedByUserId} is not null`,
    ),
    check("actions_idempotency_key_not_empty", sql`length(${table.idempotencyKey}) > 0`),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    actionId: uuid("action_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    decision: approvalDecision("decision").notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
  },
  (table) => [
    // One decision per action.
    unique("approvals_action_id_unique").on(table.actionId),
    foreignKey({
      name: "approvals_action_fk",
      columns: [table.organizationId, table.actionId],
      foreignColumns: [actions.organizationId, actions.id],
    }),
  ],
);

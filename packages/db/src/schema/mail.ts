/**
 * Mail of the last 30 days from the user's own mailbox (Gmail). Tenant data: never
 * exported from the package. Rows have the standard external columns and are unique per
 * organization as `(organization_id, source, external_id)`, so a repeated sync updates
 * instead of adding.
 *
 * What a mailbox contains is personal and untrusted. Headers needed for lists and search
 * (subject, sender, recipients) are stored readable; the body and the preview only
 * encrypted with `ENCRYPTION_KEY`. Nothing older than the window is kept, and everything is
 * deleted when the mailbox is disconnected.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { integrationConnections } from "./integrations";
import { organizations } from "./tenant";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/** Columns of every synced mail object, as on the other external tables. */
const externalColumns = () => ({
  id: uuid("id")
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  connectionId: uuid("connection_id").notNull(),
  /** Adapter identifier, e.g. "gmail". */
  source: text("source").notNull(),
  externalId: text("external_id").notNull(),
  sourceUpdatedAt: timestamptz("source_updated_at"),
  syncedAt: timestamptz("synced_at").defaultNow().notNull(),
  /** Mail is deleted outright, not soft-deleted; kept for the shape of external tables. */
  deletedAt: timestamptz("deleted_at"),
  rawHash: text("raw_hash"),
  createdAt: timestamptz("created_at").defaultNow().notNull(),
  updatedAt: timestamptz("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export interface StoredMailAddress {
  name: string | null;
  address: string;
}

export const mailMessages = pgTable(
  "mail_messages",
  {
    ...externalColumns(),
    /** The provider's thread id; threads are summarised in `mail_threads`. */
    threadExternalId: text("thread_external_id").notNull(),
    /** The provider's change marker of the message (Gmail `historyId`). */
    historyId: text("history_id"),
    receivedAt: timestamptz("received_at").notNull(),
    /** Tracked system labels only (INBOX, SENT, UNREAD, …). */
    labels: text("labels").array().notNull(),
    fromName: text("from_name"),
    fromAddress: text("from_address"),
    toAddresses: jsonb("to_addresses").$type<StoredMailAddress[]>().notNull(),
    ccAddresses: jsonb("cc_addresses").$type<StoredMailAddress[]>().notNull(),
    subject: text("subject"),
    /** Needed to reply within the thread (step 5.6). */
    messageIdHeader: text("message_id_header"),
    inReplyTo: text("in_reply_to"),
    references: text("references").array().notNull(),
    /** Preview and plain-text body, AES-256-GCM. Never logged, never sent as HTML. */
    snippetEncrypted: text("snippet_encrypted").notNull(),
    bodyEncrypted: text("body_encrypted").notNull(),
    hasAttachments: boolean("has_attachments").notNull(),
  },
  (table) => [
    unique("mail_messages_organization_source_external_unique").on(
      table.organizationId,
      table.source,
      table.externalId,
    ),
    foreignKey({
      name: "mail_messages_connection_fk",
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [integrationConnections.organizationId, integrationConnections.id],
    }),
    index("mail_messages_connection_received_idx").on(
      table.organizationId,
      table.connectionId,
      table.receivedAt,
    ),
    index("mail_messages_thread_idx").on(
      table.organizationId,
      table.source,
      table.threadExternalId,
    ),
  ],
);

/** One row per thread, recomputed from its messages after every sync. */
export const mailThreads = pgTable(
  "mail_threads",
  {
    ...externalColumns(),
    /** Subject of the first message in the thread. */
    subject: text("subject"),
    lastMessageAt: timestamptz("last_message_at").notNull(),
    messageCount: integer("message_count").notNull(),
    unread: boolean("unread").notNull(),
    inInbox: boolean("in_inbox").notNull(),
    hasSent: boolean("has_sent").notNull(),
  },
  (table) => [
    unique("mail_threads_organization_source_external_unique").on(
      table.organizationId,
      table.source,
      table.externalId,
    ),
    foreignKey({
      name: "mail_threads_connection_fk",
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [integrationConnections.organizationId, integrationConnections.id],
    }),
    index("mail_threads_connection_last_idx").on(
      table.organizationId,
      table.connectionId,
      table.lastMessageAt,
    ),
  ],
);

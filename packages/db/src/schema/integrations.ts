/**
 * Connections to external systems. Tenant data: never exported from the package; access
 * goes through the functions in `../integrations.ts`, which all take an `organizationId`.
 */
import { INTEGRATION_CATEGORIES, INTEGRATION_STATUSES } from "@bystro/core";
import { sql } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { organizations } from "./tenant";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const id = () =>
  uuid("id")
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey();

export const integrationCategory = pgEnum("integration_category", INTEGRATION_CATEGORIES);
export const integrationStatus = pgEnum("integration_status", INTEGRATION_STATUSES);

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    /** Adapter identifier, e.g. "fakturoid". Also the `source` of everything it syncs. */
    provider: text("provider").notNull(),
    category: integrationCategory("category").notNull(),
    status: integrationStatus("status").notNull(),
    /** The account at the provider (e.g. Fakturoid account slug). */
    externalAccountId: text("external_account_id"),
    /** Human-readable account name for the Propojení screen. External, untrusted text. */
    displayName: text("display_name"),
    scopes: text("scopes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    lastSyncStartedAt: timestamptz("last_sync_started_at"),
    /** Last successful sync. */
    lastSyncAt: timestamptz("last_sync_at"),
    /** Short machine code of the last problem (never a provider message or a token). */
    lastErrorCode: text("last_error_code"),
    lastErrorAt: timestamptz("last_error_at"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // One connection per provider per organization; a revoked one is reused on reconnect.
    unique("integration_connections_organization_provider_unique").on(
      table.organizationId,
      table.provider,
    ),
  ],
);

/**
 * Tokens of a connection, encrypted with AES-256-GCM (`../crypto.ts`). A separate table so
 * that ordinary reads of connections never load credentials. Deleted on disconnect.
 */
export const integrationCredentials = pgTable("integration_credentials", {
  connectionId: uuid("connection_id")
    .primaryKey()
    .references(() => integrationConnections.id),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  expiresAt: timestamptz("expires_at"),
  updatedAt: timestamptz("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

/** How far each synced resource of a connection has got. */
export const syncCursors = pgTable(
  "sync_cursors",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id),
    /** What is being synced, e.g. "invoices". */
    resource: text("resource").notNull(),
    /** Opaque position understood by the adapter (timestamp, page token, …). */
    cursor: text("cursor").notNull(),
    updatedAt: timestamptz("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("sync_cursors_connection_resource_unique").on(table.connectionId, table.resource),
  ],
);

/** Webhook deliveries already seen, so that a repeated delivery is processed only once. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id),
    source: text("source").notNull(),
    /** The provider's identifier of the delivery. */
    externalId: text("external_id").notNull(),
    receivedAt: timestamptz("received_at").defaultNow().notNull(),
    processedAt: timestamptz("processed_at"),
  },
  (table) => [
    unique("webhook_events_organization_source_external_unique").on(
      table.organizationId,
      table.source,
      table.externalId,
    ),
  ],
);

/**
 * OAuth authorizations in progress: created when the user is sent to the provider, used
 * exactly once when they come back. Only a hash of `state` is stored, and the PKCE
 * verifier is encrypted.
 */
export const oauthRequests = pgTable(
  "oauth_requests",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    provider: text("provider").notNull(),
    stateHash: text("state_hash").notNull(),
    codeVerifierEncrypted: text("code_verifier_encrypted"),
    redirectUri: text("redirect_uri").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    consumedAt: timestamptz("consumed_at"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("oauth_requests_state_hash_unique").on(table.stateHash),
    index("oauth_requests_expires_at_idx").on(table.expiresAt),
  ],
);

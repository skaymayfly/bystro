/**
 * Invoices and their counterparties, synced from invoicing systems. Tenant data: never
 * exported from the package. Every row is an external object with the standard fields
 * (`organization_id`, `source`, `external_id`, …) and is unique per organization as
 * `(organization_id, source, external_id)`, so a repeated sync updates instead of adding.
 *
 * Child rows reference their parent together with `organization_id` (composite foreign
 * keys), so the database itself refuses to link data of two organizations.
 */
import { INVOICE_DIRECTIONS, INVOICE_KINDS, INVOICE_SOURCE_STATUSES } from "@bystro/core";
import { sql, type SQL } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { integrationConnections } from "./integrations";
import { organizations } from "./tenant";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const id = () =>
  uuid("id")
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey();
const money = (name: string) => bigint(name, { mode: "bigint" });
const day = (name: string) => date(name, { mode: "string" });

/** Columns every object synced from an external system has. */
const externalColumns = () => ({
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  /** The connection it was synced through. */
  connectionId: uuid("connection_id").notNull(),
  /** Adapter identifier, e.g. "fakturoid". */
  source: text("source").notNull(),
  externalId: text("external_id").notNull(),
  sourceUpdatedAt: timestamptz("source_updated_at"),
  syncedAt: timestamptz("synced_at").defaultNow().notNull(),
  /** Set when the object disappeared at the source (soft delete). */
  deletedAt: timestamptz("deleted_at"),
  /** Hash of the source data, to skip unchanged objects; the data itself is not stored. */
  rawHash: text("raw_hash"),
  createdAt: timestamptz("created_at").defaultNow().notNull(),
  updatedAt: timestamptz("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

interface ExternalTable {
  organizationId: AnyPgColumn;
  connectionId: AnyPgColumn;
  source: AnyPgColumn;
  externalId: AnyPgColumn;
  id: AnyPgColumn;
}

/** Constraints shared by every external table. */
function externalConstraints(name: string, table: ExternalTable) {
  return [
    unique(`${name}_organization_source_external_unique`).on(
      table.organizationId,
      table.source,
      table.externalId,
    ),
    // Target of the composite foreign keys of child tables.
    unique(`${name}_organization_id_unique`).on(table.organizationId, table.id),
    foreignKey({
      name: `${name}_connection_fk`,
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [integrationConnections.organizationId, integrationConnections.id],
    }),
  ];
}

/** ISO 4217 code: three capital letters. */
const currencyFormat = (column: AnyPgColumn): SQL => sql`${column} ~ '^[A-Z]{3}$'`;

export const invoiceKind = pgEnum("invoice_kind", INVOICE_KINDS);
export const invoiceDirection = pgEnum("invoice_direction", INVOICE_DIRECTIONS);
export const invoiceSourceStatus = pgEnum("invoice_source_status", INVOICE_SOURCE_STATUSES);

/** Customers and suppliers. Personal data: names, e-mails and phones are never logged. */
export const companies = pgTable(
  "companies",
  {
    id: id(),
    ...externalColumns(),
    name: text("name").notNull(),
    ico: text("ico"),
    dic: text("dic"),
    street: text("street"),
    city: text("city"),
    postalCode: text("postal_code"),
    /** ISO 3166-1 alpha-2. */
    country: text("country"),
    email: text("email"),
    phone: text("phone"),
  },
  (table) => [
    ...externalConstraints("companies", table),
    check("companies_country_format", sql`${table.country} ~ '^[A-Z]{2}$'`),
    index("companies_organization_ico_idx").on(table.organizationId, table.ico),
  ],
);

/** People at a company (e.g. who receives the invoices). */
export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    ...externalColumns(),
    companyId: uuid("company_id"),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
  },
  (table) => [
    ...externalConstraints("contacts", table),
    foreignKey({
      name: "contacts_company_fk",
      columns: [table.organizationId, table.companyId],
      foreignColumns: [companies.organizationId, companies.id],
    }),
    index("contacts_organization_company_idx").on(table.organizationId, table.companyId),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    ...externalColumns(),
    companyId: uuid("company_id"),
    number: text("number").notNull(),
    /** Variabilní symbol. */
    variableSymbol: text("variable_symbol"),
    kind: invoiceKind("kind").notNull(),
    direction: invoiceDirection("direction").notNull(),
    sourceStatus: invoiceSourceStatus("source_status").notNull(),
    issuedOn: day("issued_on").notNull(),
    /** DUZP. */
    taxableSupplyOn: day("taxable_supply_on"),
    dueOn: day("due_on").notNull(),
    paidOn: day("paid_on"),
    /** ISO 4217. */
    currency: text("currency").notNull(),
    /** Amounts in minor units (haléře for CZK). */
    subtotalMinor: money("subtotal_minor").notNull(),
    vatMinor: money("vat_minor").notNull(),
    totalMinor: money("total_minor").notNull(),
  },
  (table) => [
    ...externalConstraints("invoices", table),
    foreignKey({
      name: "invoices_company_fk",
      columns: [table.organizationId, table.companyId],
      foreignColumns: [companies.organizationId, companies.id],
    }),
    check("invoices_currency_format", currencyFormat(table.currency)),
    check("invoices_total_sign", sql`${table.kind} = 'credit_note' or ${table.totalMinor} >= 0`),
    check("invoices_variable_symbol_format", sql`${table.variableSymbol} ~ '^[0-9]{1,10}$'`),
    index("invoices_organization_due_idx").on(table.organizationId, table.dueOn),
    index("invoices_organization_company_idx").on(table.organizationId, table.companyId),
  ],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: id(),
    ...externalColumns(),
    invoiceId: uuid("invoice_id").notNull(),
    position: integer("position").notNull(),
    /** External, untrusted text. */
    description: text("description").notNull(),
    /** Thousandths of a unit (1.5 = 1500). */
    quantityMilli: integer("quantity_milli"),
    unit: text("unit"),
    unitPriceMinor: money("unit_price_minor"),
    /** Basis points (21 % = 2100). */
    vatRateBasisPoints: integer("vat_rate_basis_points"),
    totalMinor: money("total_minor").notNull(),
  },
  (table) => [
    ...externalConstraints("invoice_lines", table),
    foreignKey({
      name: "invoice_lines_invoice_fk",
      columns: [table.organizationId, table.invoiceId],
      foreignColumns: [invoices.organizationId, invoices.id],
    }),
    check("invoice_lines_position_positive", sql`${table.position} >= 1`),
    check("invoice_lines_vat_rate_range", sql`${table.vatRateBasisPoints} between 0 and 10000`),
    index("invoice_lines_organization_invoice_idx").on(table.organizationId, table.invoiceId),
  ],
);

/** Payments as recorded by the invoicing system; bank transactions are separate (phase 3). */
export const invoicePayments = pgTable(
  "invoice_payments",
  {
    id: id(),
    ...externalColumns(),
    invoiceId: uuid("invoice_id").notNull(),
    paidOn: day("paid_on").notNull(),
    amountMinor: money("amount_minor").notNull(),
    currency: text("currency").notNull(),
  },
  (table) => [
    ...externalConstraints("invoice_payments", table),
    foreignKey({
      name: "invoice_payments_invoice_fk",
      columns: [table.organizationId, table.invoiceId],
      foreignColumns: [invoices.organizationId, invoices.id],
    }),
    check("invoice_payments_currency_format", currencyFormat(table.currency)),
    index("invoice_payments_organization_invoice_idx").on(table.organizationId, table.invoiceId),
  ],
);

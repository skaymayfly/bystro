import { createHash } from "node:crypto";

import type { Client, DateOnly, Invoice, InvoicePayment } from "@bystro/core";
import { and, asc, eq, gte, inArray, isNull, notInArray, sql } from "drizzle-orm";

import type { Db, DbTransaction } from "./client";
import { requireUuid } from "./ids";
import { companies, invoiceLines, invoicePayments, invoices } from "./schema";

/**
 * Invoices, their clients and payments as synced from invoicing systems. Every function
 * takes the `organizationId` and filters by it. Writes are idempotent: an object is found
 * by `(organization_id, source, external_id)`, so syncing the same data again changes
 * nothing, and unchanged objects are recognised by a hash and not rewritten.
 */

export type StoredCompany = typeof companies.$inferSelect;
export type StoredInvoice = typeof invoices.$inferSelect;
export type StoredInvoicePayment = typeof invoicePayments.$inferSelect;

/** Whose data a sync writes: the organization and the connection it runs through. */
export interface SyncScope {
  organizationId: string;
  connectionId: string;
}

export interface UpsertCounts {
  created: number;
  updated: number;
  /** Already stored with the same content. */
  unchanged: number;
}

const emptyCounts = (): UpsertCounts => ({ created: 0, updated: 0, unchanged: 0 });

function validScope(scope: SyncScope): SyncScope {
  return {
    organizationId: requireUuid(scope.organizationId, "organizationId"),
    connectionId: requireUuid(scope.connectionId, "connectionId"),
  };
}

/** Stable hash of a mapped object; `bigint` and `Date` are written as text. */
function contentHash(value: unknown): string {
  const json = JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? `${item}n` : item,
  );
  return createHash("sha256").update(json).digest("hex");
}

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

// ---------------------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------------------

/** Creates or updates clients. A client that was marked deleted comes back to life. */
export async function upsertCompanies(
  db: Db,
  scope: SyncScope,
  clients: readonly Client[],
): Promise<UpsertCounts> {
  const { organizationId, connectionId } = validScope(scope);
  const counts = emptyCounts();
  if (clients.length === 0) {
    return counts;
  }

  await db.transaction(async (tx) => {
    for (const source of unique(clients.map((client) => client.source))) {
      const batch = clients.filter((client) => client.source === source);
      const existing = await tx
        .select({
          id: companies.id,
          externalId: companies.externalId,
          rawHash: companies.rawHash,
          deletedAt: companies.deletedAt,
        })
        .from(companies)
        .where(
          and(
            eq(companies.organizationId, organizationId),
            eq(companies.source, source),
            inArray(companies.externalId, unique(batch.map((client) => client.externalId))),
          ),
        );
      const byExternalId = new Map(existing.map((row) => [row.externalId, row]));

      for (const client of batch) {
        const rawHash = contentHash(client);
        const stored = byExternalId.get(client.externalId);
        if (stored !== undefined && stored.rawHash === rawHash && stored.deletedAt === null) {
          counts.unchanged += 1;
          continue;
        }
        const values = {
          name: client.name,
          ico: client.ico,
          dic: client.dic,
          street: client.street,
          city: client.city,
          postalCode: client.postalCode,
          country: client.country,
          email: client.email,
          phone: client.phone,
          sourceUpdatedAt: client.sourceUpdatedAt,
          syncedAt: new Date(),
          deletedAt: null,
          rawHash,
        };
        if (stored === undefined) {
          const [inserted] = await tx
            .insert(companies)
            .values({
              organizationId,
              connectionId,
              source,
              externalId: client.externalId,
              ...values,
            })
            .returning({ id: companies.id });
          if (inserted !== undefined) {
            byExternalId.set(client.externalId, {
              id: inserted.id,
              externalId: client.externalId,
              rawHash,
              deletedAt: null,
            });
          }
          counts.created += 1;
        } else {
          await tx.update(companies).set(values).where(eq(companies.id, stored.id));
          counts.updated += 1;
        }
      }
    }
  });
  return counts;
}

/** Of the given client ids, those the organization does not have (or has as deleted). */
export async function findUnknownCompanyExternalIds(
  db: Db,
  organizationId: string,
  source: string,
  externalIds: readonly string[],
): Promise<string[]> {
  const wanted = unique(externalIds);
  if (wanted.length === 0) {
    return [];
  }
  const known = await db
    .select({ externalId: companies.externalId })
    .from(companies)
    .where(
      and(
        eq(companies.organizationId, requireUuid(organizationId, "organizationId")),
        eq(companies.source, source),
        inArray(companies.externalId, wanted),
        isNull(companies.deletedAt),
      ),
    );
  const knownIds = new Set(known.map((row) => row.externalId));
  return wanted.filter((externalId) => !knownIds.has(externalId));
}

// ---------------------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------------------

export interface InvoiceUpsertResult {
  invoices: UpsertCounts;
  /** `unchanged` is not tracked for payments: they are written with their invoice. */
  payments: { created: number; updated: number; removed: number };
}

async function writeLines(
  tx: DbTransaction,
  scope: SyncScope,
  invoiceId: string,
  invoice: Invoice,
): Promise<void> {
  const now = new Date();
  for (const line of invoice.lines) {
    const values = {
      invoiceId,
      position: line.position,
      description: line.description,
      quantityMilli: line.quantityMilli,
      unit: line.unit,
      unitPriceMinor: line.unitPriceMinor,
      vatRateBasisPoints: line.vatRateBasisPoints,
      totalMinor: line.totalMinor,
      syncedAt: now,
      deletedAt: null,
    };
    await tx
      .insert(invoiceLines)
      .values({ ...scope, source: invoice.source, externalId: line.externalId, ...values })
      .onConflictDoUpdate({
        target: [invoiceLines.organizationId, invoiceLines.source, invoiceLines.externalId],
        set: values,
      });
  }
  // Lines that are no longer on the invoice.
  const kept = invoice.lines.map((line) => line.externalId);
  await tx
    .update(invoiceLines)
    .set({ deletedAt: now })
    .where(
      and(
        eq(invoiceLines.organizationId, scope.organizationId),
        eq(invoiceLines.invoiceId, invoiceId),
        isNull(invoiceLines.deletedAt),
        kept.length === 0 ? undefined : notInArray(invoiceLines.externalId, kept),
      ),
    );
}

async function writePayments(
  tx: DbTransaction,
  scope: SyncScope,
  invoiceId: string,
  source: string,
  payments: readonly InvoicePayment[],
  result: InvoiceUpsertResult["payments"],
): Promise<void> {
  const now = new Date();
  const existing = await tx
    .select({
      id: invoicePayments.id,
      externalId: invoicePayments.externalId,
      rawHash: invoicePayments.rawHash,
      deletedAt: invoicePayments.deletedAt,
    })
    .from(invoicePayments)
    .where(
      and(
        eq(invoicePayments.organizationId, scope.organizationId),
        eq(invoicePayments.invoiceId, invoiceId),
      ),
    );
  const byExternalId = new Map(existing.map((row) => [row.externalId, row]));

  for (const payment of payments) {
    const rawHash = contentHash(payment);
    const stored = byExternalId.get(payment.externalId);
    byExternalId.delete(payment.externalId);
    if (stored !== undefined && stored.rawHash === rawHash && stored.deletedAt === null) {
      continue;
    }
    const values = {
      invoiceId,
      paidOn: payment.paidOn,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      sourceUpdatedAt: payment.sourceUpdatedAt,
      syncedAt: now,
      deletedAt: null,
      rawHash,
    };
    if (stored === undefined) {
      await tx
        .insert(invoicePayments)
        .values({ ...scope, source, externalId: payment.externalId, ...values });
      result.created += 1;
    } else {
      await tx.update(invoicePayments).set(values).where(eq(invoicePayments.id, stored.id));
      result.updated += 1;
    }
  }

  // What is left was removed at the source.
  for (const stale of byExternalId.values()) {
    if (stale.deletedAt === null) {
      await tx
        .update(invoicePayments)
        .set({ deletedAt: now })
        .where(eq(invoicePayments.id, stale.id));
      result.removed += 1;
    }
  }
}

/**
 * Creates or updates invoices with their lines and, when the invoice carries them, its
 * payments (the carried list is complete: payments missing from it are marked deleted).
 * The client is linked when the organization already has it; sync clients first.
 */
export async function upsertInvoices(
  db: Db,
  scope: SyncScope,
  items: readonly Invoice[],
): Promise<InvoiceUpsertResult> {
  const validated = validScope(scope);
  const { organizationId, connectionId } = validated;
  const result: InvoiceUpsertResult = {
    invoices: emptyCounts(),
    payments: { created: 0, updated: 0, removed: 0 },
  };
  if (items.length === 0) {
    return result;
  }

  await db.transaction(async (tx) => {
    for (const source of unique(items.map((invoice) => invoice.source))) {
      const batch = items.filter((invoice) => invoice.source === source);
      const clientIds = unique(
        batch.map((invoice) => invoice.clientExternalId).filter((id) => id !== null),
      );
      const clientRows =
        clientIds.length === 0
          ? []
          : await tx
              .select({ id: companies.id, externalId: companies.externalId })
              .from(companies)
              .where(
                and(
                  eq(companies.organizationId, organizationId),
                  eq(companies.source, source),
                  inArray(companies.externalId, clientIds),
                ),
              );
      const companyIds = new Map(clientRows.map((row) => [row.externalId, row.id]));

      const existing = await tx
        .select({
          id: invoices.id,
          externalId: invoices.externalId,
          rawHash: invoices.rawHash,
          deletedAt: invoices.deletedAt,
          companyId: invoices.companyId,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.organizationId, organizationId),
            eq(invoices.source, source),
            inArray(invoices.externalId, unique(batch.map((invoice) => invoice.externalId))),
          ),
        );
      const byExternalId = new Map(existing.map((row) => [row.externalId, row]));

      for (const invoice of batch) {
        // Payments are hashed with the invoice so that a new payment is never missed.
        const rawHash = contentHash(invoice);
        const companyId =
          invoice.clientExternalId === null
            ? null
            : (companyIds.get(invoice.clientExternalId) ?? null);
        const stored = byExternalId.get(invoice.externalId);
        if (
          stored !== undefined &&
          stored.rawHash === rawHash &&
          stored.deletedAt === null &&
          stored.companyId === companyId
        ) {
          result.invoices.unchanged += 1;
          continue;
        }

        const values = {
          companyId,
          number: invoice.number,
          variableSymbol: invoice.variableSymbol,
          kind: invoice.kind,
          direction: invoice.direction,
          sourceStatus: invoice.sourceStatus,
          issuedOn: invoice.issuedOn,
          taxableSupplyOn: invoice.taxableSupplyOn,
          dueOn: invoice.dueOn,
          paidOn: invoice.paidOn,
          currency: invoice.currency,
          subtotalMinor: invoice.subtotalMinor,
          vatMinor: invoice.vatMinor,
          totalMinor: invoice.totalMinor,
          sourceUpdatedAt: invoice.sourceUpdatedAt,
          syncedAt: new Date(),
          deletedAt: null,
          rawHash,
        };
        let invoiceId: string;
        if (stored === undefined) {
          const [inserted] = await tx
            .insert(invoices)
            .values({
              organizationId,
              connectionId,
              source,
              externalId: invoice.externalId,
              ...values,
            })
            .returning({ id: invoices.id });
          if (inserted === undefined) {
            throw new Error("Invoice insert returned no row.");
          }
          invoiceId = inserted.id;
          result.invoices.created += 1;
        } else {
          await tx.update(invoices).set(values).where(eq(invoices.id, stored.id));
          invoiceId = stored.id;
          result.invoices.updated += 1;
        }

        await writeLines(tx, validated, invoiceId, invoice);
        if (invoice.payments !== null) {
          await writePayments(tx, validated, invoiceId, source, invoice.payments, result.payments);
        }
      }
    }
  });
  return result;
}

/**
 * External ids of the connection's invoices that are not deleted and were issued on or
 * after the given day: what a full sync compares the source against.
 */
export async function listActiveInvoiceExternalIds(
  db: Db,
  scope: SyncScope,
  source: string,
  issuedOnOrAfter: DateOnly,
): Promise<string[]> {
  const { organizationId, connectionId } = validScope(scope);
  const rows = await db
    .select({ externalId: invoices.externalId })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.connectionId, connectionId),
        eq(invoices.source, source),
        isNull(invoices.deletedAt),
        gte(invoices.issuedOn, issuedOnOrAfter),
      ),
    );
  return rows.map((row) => row.externalId);
}

/**
 * Marks invoices as deleted (they disappeared at the source). The rows stay, so history
 * and audit keep making sense. Returns how many were marked now.
 */
export async function markInvoicesDeleted(
  db: Db,
  organizationId: string,
  source: string,
  externalIds: readonly string[],
): Promise<number> {
  if (externalIds.length === 0) {
    return 0;
  }
  const marked = await db
    .update(invoices)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(invoices.organizationId, requireUuid(organizationId, "organizationId")),
        eq(invoices.source, source),
        inArray(invoices.externalId, unique(externalIds)),
        isNull(invoices.deletedAt),
      ),
    )
    .returning({ id: invoices.id });
  return marked.length;
}

// ---------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------

/** Invoices of the organization by due date. Deleted ones only when asked for. */
export async function listInvoices(
  db: Db,
  organizationId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<StoredInvoice[]> {
  return db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, requireUuid(organizationId, "organizationId")),
        options.includeDeleted === true ? undefined : isNull(invoices.deletedAt),
      ),
    )
    .orderBy(asc(invoices.dueOn), asc(invoices.number), asc(invoices.id));
}

/** Payments of the organization's invoices that still exist at the source. */
export async function listInvoicePayments(
  db: Db,
  organizationId: string,
): Promise<StoredInvoicePayment[]> {
  return db
    .select()
    .from(invoicePayments)
    .where(
      and(
        eq(invoicePayments.organizationId, requireUuid(organizationId, "organizationId")),
        isNull(invoicePayments.deletedAt),
      ),
    )
    .orderBy(asc(invoicePayments.paidOn), asc(invoicePayments.id));
}

/** Clients of the organization that still exist at the source, by name. */
export async function listCompanies(db: Db, organizationId: string): Promise<StoredCompany[]> {
  return db
    .select()
    .from(companies)
    .where(
      and(
        eq(companies.organizationId, requireUuid(organizationId, "organizationId")),
        isNull(companies.deletedAt),
      ),
    )
    .orderBy(asc(companies.name), asc(companies.id));
}

/** Number of non-deleted line rows of an invoice; used to verify syncs. */
export async function countInvoiceLines(
  db: Db,
  organizationId: string,
  invoiceId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(invoiceLines)
    .where(
      and(
        eq(invoiceLines.organizationId, requireUuid(organizationId, "organizationId")),
        eq(invoiceLines.invoiceId, requireUuid(invoiceId, "invoiceId")),
        isNull(invoiceLines.deletedAt),
      ),
    );
  return row?.count ?? 0;
}

import { todayInPrague, type DateOnly, type Invoice, type InvoiceProvider } from "@bystro/core";
import {
  findUnknownCompanyExternalIds,
  getSyncCursor,
  listActiveInvoiceExternalIds,
  markInvoicesDeleted,
  setSyncCursor,
  upsertCompanies,
  upsertInvoices,
  type Db,
  type SyncScope,
} from "@bystro/db";

/**
 * Brings invoices, their clients and payments from an invoicing system into Bystro.
 * Knows no concrete provider: it works with any {@link InvoiceProvider}.
 *
 * Idempotent: objects are matched by `(organization, source, external id)`, so running it
 * twice over the same data creates nothing new. Requests to the provider are kept to a
 * minimum, because providers limit them (Fakturoid accounts have a monthly allowance).
 */

export const INVOICE_SYNC_MODES = ["incremental", "full"] as const;
/**
 * - `incremental`: only what changed since the last run (usually one request).
 * - `full`: everything created in the look-back window, then a check of what disappeared.
 *   Also what the first sync of a connection always is.
 */
export type InvoiceSyncMode = (typeof INVOICE_SYNC_MODES)[number];

/** How far back the first and every full sync reach. */
export const INVOICE_SYNC_LOOKBACK_MONTHS = 12;
/** Incremental runs re-read this much before the last run, so nothing falls in a gap. */
const INCREMENTAL_OVERLAP_MS = 5 * 60 * 1000;
/** Safety stop for a provider that keeps returning a next page. */
const MAX_PAGES = 500;

const CURSOR_RESOURCE = "invoices";

export interface InvoiceSyncInput {
  db: Db;
  scope: SyncScope;
  provider: InvoiceProvider;
  mode: InvoiceSyncMode;
  now?: Date;
}

export interface InvoiceSyncResult {
  /** The mode that actually ran: a first sync is always `full`. */
  mode: InvoiceSyncMode;
  clients: { created: number; updated: number; unchanged: number };
  invoices: { created: number; updated: number; unchanged: number; deleted: number };
  payments: { created: number; updated: number; removed: number };
}

function monthsBefore(moment: Date, months: number): Date {
  const result = new Date(moment);
  result.setUTCMonth(result.getUTCMonth() - months);
  return result;
}

const add = <T extends Record<string, number>>(total: T, part: Partial<T>): void => {
  for (const key of Object.keys(part) as (keyof T)[]) {
    total[key] = ((total[key] as number) + ((part[key] as number | undefined) ?? 0)) as T[keyof T];
  }
};

export async function syncInvoices(input: InvoiceSyncInput): Promise<InvoiceSyncResult> {
  const { db, scope, provider } = input;
  const now = input.now ?? new Date();
  const source = provider.source;

  const cursor = await getSyncCursor(db, scope.organizationId, scope.connectionId, CURSOR_RESOURCE);
  const lastRun = cursor === null ? null : new Date(cursor);
  const mode: InvoiceSyncMode =
    lastRun === null || Number.isNaN(lastRun.getTime()) ? "full" : input.mode;
  const lookbackStart = monthsBefore(now, INVOICE_SYNC_LOOKBACK_MONTHS);

  const result: InvoiceSyncResult = {
    mode,
    clients: { created: 0, updated: 0, unchanged: 0 },
    invoices: { created: 0, updated: 0, unchanged: 0, deleted: 0 },
    payments: { created: 0, updated: 0, removed: 0 },
  };

  async function syncClients(updatedSince: Date | undefined): Promise<void> {
    let next: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const batch = await provider.listClients({
        cursor: next,
        ...(updatedSince === undefined ? {} : { updatedSince }),
      });
      add(result.clients, await upsertCompanies(db, scope, batch.items));
      next = batch.nextCursor;
      if (next === null) return;
    }
  }

  async function store(invoices: readonly Invoice[]): Promise<void> {
    const written = await upsertInvoices(db, scope, invoices);
    add(result.invoices, written.invoices);
    add(result.payments, written.payments);
  }

  // Clients first, so that invoices can be linked to them.
  if (mode === "full") {
    await syncClients(undefined);
  }

  const listOptions =
    mode === "full"
      ? { createdSince: lookbackStart }
      : { updatedSince: new Date((lastRun as Date).getTime() - INCREMENTAL_OVERLAP_MS) };
  const seen = new Set<string>();
  let next: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = await provider.listInvoices({ cursor: next, ...listOptions });
    for (const invoice of batch.items) {
      seen.add(invoice.externalId);
    }

    if (mode === "incremental") {
      // Fetch clients only when an invoice refers to one we do not have yet.
      const clientIds = batch.items
        .map((invoice) => invoice.clientExternalId)
        .filter((id) => id !== null);
      const unknown = await findUnknownCompanyExternalIds(
        db,
        scope.organizationId,
        source,
        clientIds,
      );
      if (unknown.length > 0) {
        await syncClients(listOptions.updatedSince);
      }
    }

    await store(batch.items);
    next = batch.nextCursor;
    if (next === null) break;
  }

  if (mode === "full") {
    // What we have from the window but the source no longer lists. Each candidate is
    // asked for individually before it is marked deleted, so that an invoice merely
    // outside the listing (e.g. created before the window) is never lost.
    const lookbackDay: DateOnly = todayInPrague(lookbackStart);
    const stored = await listActiveInvoiceExternalIds(db, scope, source, lookbackDay);
    const gone: string[] = [];
    const stillThere: Invoice[] = [];
    for (const externalId of stored) {
      if (seen.has(externalId)) continue;
      const invoice = await provider.getInvoice(externalId);
      if (invoice === null) {
        gone.push(externalId);
      } else {
        stillThere.push(invoice);
      }
    }
    await store(stillThere);
    result.invoices.deleted = await markInvoicesDeleted(db, scope.organizationId, source, gone);
  }

  // Only after everything succeeded: a failed run is repeated from the previous position.
  await setSyncCursor(
    db,
    scope.organizationId,
    scope.connectionId,
    CURSOR_RESOURCE,
    now.toISOString(),
  );
  return result;
}

/**
 * Wraps a provider so that `beforeRequest` runs before every call to the source, e.g. to
 * count the call against a rate limit (and throw when the limit is used up).
 */
export function withRequestHook(
  provider: InvoiceProvider,
  beforeRequest: () => Promise<void>,
): InvoiceProvider {
  return {
    source: provider.source,
    async listInvoices(options) {
      await beforeRequest();
      return provider.listInvoices(options);
    },
    async getInvoice(externalId) {
      await beforeRequest();
      return provider.getInvoice(externalId);
    },
    async listClients(options) {
      await beforeRequest();
      return provider.listClients(options);
    },
    async listPayments(options) {
      await beforeRequest();
      return provider.listPayments(options);
    },
    async getDocument(invoiceExternalId) {
      await beforeRequest();
      return provider.getDocument(invoiceExternalId);
    },
  };
}

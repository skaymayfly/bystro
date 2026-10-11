import { toDateParts, type DateOnly } from "./format";
import {
  invoiceStatus,
  type InvoiceKind,
  type InvoiceSourceStatus,
  type InvoiceStatus,
} from "./invoices";

/**
 * What the Faktury screen and the Přehled card show: invoices with their computed status,
 * filtered, sorted and summed. Pure functions over data already loaded for one company;
 * every number comes from here, never from a language model.
 */

/** An invoice as stored, with the sum of its payments. */
export interface InvoiceOverviewInput {
  id: string;
  number: string;
  kind: InvoiceKind;
  sourceStatus: InvoiceSourceStatus;
  issuedOn: DateOnly;
  dueOn: DateOnly;
  paidOn: DateOnly | null;
  currency: string;
  totalMinor: bigint;
  /** Payments recorded in the invoice's currency. */
  paidMinor: bigint;
  clientName: string | null;
}

export type ListedInvoiceStatus = Exclude<InvoiceStatus, "draft" | "cancelled">;

export interface InvoiceRow extends InvoiceOverviewInput {
  status: ListedInvoiceStatus;
  /** Whole days after the due date; 0 unless overdue. */
  daysOverdue: number;
  /** Whole days until the due date (0 = due today); negative when past it. */
  daysUntilDue: number;
  /** What is still to be paid; 0 when paid. */
  remainingMinor: bigint;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: DateOnly, to: DateOnly): number {
  const day = (value: DateOnly) => {
    const { year, month, day: dayOfMonth } = toDateParts(value);
    return Date.UTC(year, month - 1, dayOfMonth) / DAY_MS;
  };
  return day(to) - day(from);
}

/**
 * Computes the status of every invoice for the given day. Drafts and cancelled invoices
 * are left out: they are neither money to come nor money received.
 */
export function buildInvoiceRows(
  invoices: readonly InvoiceOverviewInput[],
  today: DateOnly,
): InvoiceRow[] {
  const rows: InvoiceRow[] = [];
  for (const invoice of invoices) {
    const { status, daysOverdue, remainingMinor } = invoiceStatus(
      invoice,
      [{ amountMinor: invoice.paidMinor, currency: invoice.currency }],
      today,
    );
    if (status === "draft" || status === "cancelled") {
      continue;
    }
    rows.push({
      ...invoice,
      status,
      daysOverdue,
      daysUntilDue: daysBetween(today, invoice.dueOn),
      remainingMinor,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------------------
// Filtering, searching, sorting
// ---------------------------------------------------------------------------------------

export const INVOICE_FILTERS = ["all", "overdue", "due_soon", "pending", "paid"] as const;
/** `pending` = not paid and not overdue (it includes `due_soon`). */
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number];

export const INVOICE_SORTS = ["due", "amount", "number", "client"] as const;
export type InvoiceSort = (typeof INVOICE_SORTS)[number];

function matchesFilter(row: InvoiceRow, filter: InvoiceFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "overdue":
      return row.status === "overdue";
    case "due_soon":
      return row.status === "due_soon";
    case "pending":
      return row.status === "due_soon" || row.status === "open";
    case "paid":
      return row.status === "paid";
  }
}

/** Lower case without diacritics, so that "novak" finds "Novák". */
const searchable = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("cs-CZ");

export function filterInvoiceRows(
  rows: readonly InvoiceRow[],
  options: { filter?: InvoiceFilter; query?: string },
): InvoiceRow[] {
  const filter = options.filter ?? "all";
  const query = searchable(options.query?.trim() ?? "");
  return rows.filter(
    (row) =>
      matchesFilter(row, filter) &&
      (query === "" ||
        searchable(row.number).includes(query) ||
        searchable(row.clientName ?? "").includes(query)),
  );
}

const collator = new Intl.Collator("cs-CZ", { numeric: true, sensitivity: "base" });
const compareBigInt = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * - `due` (default): unpaid first, the longest overdue on top; then paid, newest first.
 * - `amount`: largest total first. `number`: newest number first. `client`: by name.
 */
export function sortInvoiceRows(
  rows: readonly InvoiceRow[],
  sort: InvoiceSort = "due",
): InvoiceRow[] {
  const byNumber = (a: InvoiceRow, b: InvoiceRow) => collator.compare(b.number, a.number);
  const compare: Record<InvoiceSort, (a: InvoiceRow, b: InvoiceRow) => number> = {
    due: (a, b) => {
      const paidA = a.status === "paid";
      const paidB = b.status === "paid";
      if (paidA !== paidB) return paidA ? 1 : -1;
      const byDue = paidA ? daysBetween(a.dueOn, b.dueOn) : daysBetween(b.dueOn, a.dueOn);
      return byDue !== 0 ? byDue : byNumber(a, b);
    },
    amount: (a, b) => compareBigInt(b.totalMinor, a.totalMinor) || byNumber(a, b),
    number: byNumber,
    client: (a, b) => collator.compare(a.clientName ?? "￿", b.clientName ?? "￿") || byNumber(a, b),
  };
  return [...rows].sort(compare[sort]);
}

// ---------------------------------------------------------------------------------------
// Sums
// ---------------------------------------------------------------------------------------

export interface InvoiceGroupSummary {
  count: number;
  /** In the summary currency only; invoices in other currencies are counted, not summed. */
  sumMinor: bigint;
}

export interface InvoiceSummary {
  currency: string;
  /** Unpaid remainder of overdue invoices. */
  overdue: InvoiceGroupSummary;
  /** Unpaid remainder of invoices not yet due. */
  pending: InvoiceGroupSummary;
  /** Totals of paid invoices. */
  paid: InvoiceGroupSummary;
  /** The invoice that is overdue the longest, if any. */
  oldestOverdue: InvoiceRow | null;
  /** Invoices in another currency: listed, but left out of every sum above. */
  otherCurrencyCount: number;
}

/** Sums by status. Amounts are added only in `currency`; there is no exchange-rate guess. */
export function summarizeInvoices(rows: readonly InvoiceRow[], currency = "CZK"): InvoiceSummary {
  const summary: InvoiceSummary = {
    currency,
    overdue: { count: 0, sumMinor: 0n },
    pending: { count: 0, sumMinor: 0n },
    paid: { count: 0, sumMinor: 0n },
    oldestOverdue: null,
    otherCurrencyCount: 0,
  };
  for (const row of rows) {
    const group =
      row.status === "overdue"
        ? summary.overdue
        : row.status === "paid"
          ? summary.paid
          : summary.pending;
    group.count += 1;
    if (row.currency === currency) {
      group.sumMinor += row.status === "paid" ? row.totalMinor : row.remainingMinor;
    } else {
      summary.otherCurrencyCount += 1;
    }
    if (
      row.status === "overdue" &&
      (summary.oldestOverdue === null || row.daysOverdue > summary.oldestOverdue.daysOverdue)
    ) {
      summary.oldestOverdue = row;
    }
  }
  return summary;
}

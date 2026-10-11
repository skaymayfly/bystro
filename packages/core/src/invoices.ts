import { toDateParts, type DateOnly } from "./format";

/**
 * Invoices independent of any invoicing system. Adapters (Fakturoid, iDoklad, …) map their
 * data onto these types; everything after the adapter works only with them.
 *
 * Money is always a whole number of minor units (haléře for CZK) as `bigint`, together with
 * an ISO 4217 currency code. Days without time are {@link DateOnly}.
 */

export const INVOICE_KINDS = ["invoice", "proforma", "credit_note"] as const;
/** Ordinary invoice, proforma (advance) invoice, or credit note (opravný daňový doklad). */
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const INVOICE_DIRECTIONS = ["issued", "received"] as const;
/** `issued` = we invoice a client (money comes in), `received` = a supplier invoices us. */
export type InvoiceDirection = (typeof INVOICE_DIRECTIONS)[number];

export const INVOICE_SOURCE_STATUSES = ["draft", "open", "paid", "cancelled"] as const;
/** The invoicing system's own view, normalised by the adapter. */
export type InvoiceSourceStatus = (typeof INVOICE_SOURCE_STATUSES)[number];

/** Where an object comes from: unique per organization as `(source, externalId)`. */
export interface ExternalReference {
  /** Adapter identifier, e.g. `fakturoid`. */
  source: string;
  /** The object's id at the source. */
  externalId: string;
  /** When the source last changed it, if the source says. */
  sourceUpdatedAt: Date | null;
}

/** A customer or supplier as the invoicing system knows it. External, untrusted text. */
export interface Client extends ExternalReference {
  name: string;
  ico: string | null;
  dic: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  /** ISO 3166-1 alpha-2. */
  country: string | null;
  email: string | null;
  phone: string | null;
}

export interface InvoiceLine {
  /** Id of the line at the source; adapters without one use `<invoice id>#<position>`. */
  externalId: string;
  /** Order on the invoice, from 1. */
  position: number;
  description: string;
  /** Quantity in thousandths (1.5 pieces = 1500). */
  quantityMilli: number | null;
  unit: string | null;
  unitPriceMinor: bigint | null;
  /** VAT rate in basis points (21 % = 2100). */
  vatRateBasisPoints: number | null;
  totalMinor: bigint;
}

export interface Invoice extends ExternalReference {
  number: string;
  /** Variabilní symbol: digits used to match bank payments. */
  variableSymbol: string | null;
  kind: InvoiceKind;
  direction: InvoiceDirection;
  sourceStatus: InvoiceSourceStatus;
  clientExternalId: string | null;
  issuedOn: DateOnly;
  /** DUZP (datum uskutečnění zdanitelného plnění). */
  taxableSupplyOn: DateOnly | null;
  dueOn: DateOnly;
  /** When the source marked it paid. */
  paidOn: DateOnly | null;
  currency: string;
  subtotalMinor: bigint;
  vatMinor: bigint;
  /** Negative only for credit notes. */
  totalMinor: bigint;
  lines: readonly InvoiceLine[];
}

/** A payment as recorded by the invoicing system (not a bank transaction). */
export interface InvoicePayment extends ExternalReference {
  invoiceExternalId: string;
  paidOn: DateOnly;
  amountMinor: bigint;
  currency: string;
}

export interface Page<TItem> {
  items: readonly TItem[];
  /** Pass to the next call to continue; `null` when there is nothing more. */
  nextCursor: string | null;
}

export interface ListOptions {
  cursor?: string | null;
  /** Only objects changed since this moment (incremental sync). */
  updatedSince?: Date;
}

export interface InvoiceDocument {
  fileName: string;
  contentType: string;
  content: Uint8Array;
}

/** What every invoicing adapter provides. Read-only. */
export interface InvoiceProvider {
  readonly source: string;
  listInvoices(options?: ListOptions): Promise<Page<Invoice>>;
  /** `null` when the invoice does not exist (any more) at the source. */
  getInvoice(externalId: string): Promise<Invoice | null>;
  listClients(options?: ListOptions): Promise<Page<Client>>;
  listPayments(options?: ListOptions): Promise<Page<InvoicePayment>>;
  /** The invoice as a file (usually PDF); `null` when the source has none. */
  getDocument(invoiceExternalId: string): Promise<InvoiceDocument | null>;
}

// ---------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------

export const INVOICE_STATUSES = [
  "draft",
  "cancelled",
  "paid",
  "overdue",
  "due_soon",
  "open",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** An invoice due within this many days (inclusive) is "brzy splatná". */
export const DUE_SOON_DAYS = 7;

export interface InvoiceStatusResult {
  status: InvoiceStatus;
  /** Whole days after the due date; 0 unless overdue. */
  daysOverdue: number;
  /** Sum of the payments in the invoice's currency. */
  paidMinor: bigint;
  /** What is still to be paid; 0 when paid, cancelled or a draft, never negative. */
  remainingMinor: bigint;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayNumber(day: DateOnly): number {
  const { year, month, day: dayOfMonth } = toDateParts(day);
  return Date.UTC(year, month - 1, dayOfMonth) / DAY_MS;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The calendar day it is in Europe/Prague at the given moment. */
export function todayInPrague(now: Date): DateOnly {
  const { year, month, day } = toDateParts(now);
  return `${year}-${pad(month)}-${pad(day)}` as DateOnly;
}

/**
 * Where an invoice stands on a given day (in Europe/Prague, see {@link todayInPrague}).
 *
 * Paid means the invoicing system says so, or recorded payments cover the total exactly
 * or more. Nothing is ever considered paid because an amount is merely close. A partial
 * payment leaves the status as it was and lowers the remaining amount. The due day itself
 * is not overdue yet. Credit notes are never due: they are open or paid.
 */
export function invoiceStatus(
  invoice: Pick<Invoice, "kind" | "sourceStatus" | "dueOn" | "totalMinor" | "currency">,
  payments: readonly Pick<InvoicePayment, "amountMinor" | "currency">[],
  today: DateOnly,
): InvoiceStatusResult {
  const paidMinor = payments
    .filter((payment) => payment.currency === invoice.currency)
    .reduce((sum, payment) => sum + payment.amountMinor, 0n);
  const outstanding = invoice.totalMinor - paidMinor;
  const remainingMinor = outstanding > 0n ? outstanding : 0n;
  const result = (status: InvoiceStatus, daysOverdue = 0, remaining = remainingMinor) => ({
    status,
    daysOverdue,
    paidMinor,
    remainingMinor: remaining,
  });

  if (invoice.sourceStatus === "draft" || invoice.sourceStatus === "cancelled") {
    return result(invoice.sourceStatus, 0, 0n);
  }
  const coveredByPayments = invoice.totalMinor > 0n && paidMinor >= invoice.totalMinor;
  if (invoice.sourceStatus === "paid" || coveredByPayments) {
    return result("paid", 0, 0n);
  }
  if (invoice.kind === "credit_note") {
    return result("open");
  }

  const daysPastDue = dayNumber(today) - dayNumber(invoice.dueOn);
  if (daysPastDue > 0) {
    return result("overdue", daysPastDue);
  }
  if (daysPastDue >= -DUE_SOON_DAYS) {
    return result("due_soon");
  }
  return result("open");
}

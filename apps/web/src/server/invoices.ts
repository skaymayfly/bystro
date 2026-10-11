import {
  buildInvoiceRows,
  summarizeInvoices,
  todayInPrague,
  type DateOnly,
  type InvoiceRow,
  type InvoiceSummary,
} from "@bystro/core";
import { listInvoiceOverview } from "@bystro/db";

import { getDb } from "./db";

export interface InvoiceOverview {
  /** The day the statuses were computed for (Europe/Prague). */
  today: DateOnly;
  rows: InvoiceRow[];
  summary: InvoiceSummary;
}

/** Invoices of one company with their status as of today, and the sums by status. */
export async function loadInvoiceOverview(
  organizationId: string,
  now: Date = new Date(),
): Promise<InvoiceOverview> {
  const today = todayInPrague(now);
  const rows = buildInvoiceRows(await listInvoiceOverview(getDb(), organizationId), today);
  return { today, rows, summary: summarizeInvoices(rows) };
}

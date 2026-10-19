import { invoiceStatus, todayInPrague, type DateOnly } from "@bystro/core";

import type { Db } from "./client";
import { getInvoiceDetail } from "./invoices";
import type { StoredAction } from "./actions";

/**
 * Whether an action still makes sense with today's data. Checked when the user approves it
 * and again right before it is carried out, because the data may change in between (the
 * client pays the invoice an hour after the reminder was proposed).
 *
 * - `source_missing`: what the action is about no longer exists (deleted at the source)
 * - `source_changed`: it exists, but the reason for the action went away
 */
export type ActionCheck = { ok: true } | { ok: false; reason: "source_missing" | "source_changed" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A reminder makes sense only for an invoice that is still overdue today (Europe/Prague). */
async function checkInvoiceReminder(db: Db, action: StoredAction, now: Date): Promise<ActionCheck> {
  const source = action.sources.find((item) => item.type === "invoice");
  if (source === undefined || !UUID.test(source.id)) {
    return { ok: false, reason: "source_missing" };
  }
  const detail = await getInvoiceDetail(db, action.organizationId, source.id);
  if (detail === null) {
    return { ok: false, reason: "source_missing" };
  }
  const { invoice, payments } = detail;
  const { status } = invoiceStatus(
    {
      kind: invoice.kind,
      sourceStatus: invoice.sourceStatus,
      dueOn: invoice.dueOn as DateOnly,
      totalMinor: invoice.totalMinor,
      currency: invoice.currency,
    },
    payments,
    todayInPrague(now),
  );
  return status === "overdue" ? { ok: true } : { ok: false, reason: "source_changed" };
}

export async function checkActionStillValid(
  db: Db,
  action: StoredAction,
  now: Date = new Date(),
): Promise<ActionCheck> {
  switch (action.type) {
    case "invoice_reminder":
      return checkInvoiceReminder(db, action, now);
  }
}

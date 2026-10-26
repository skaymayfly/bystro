import {
  buildInvoiceRows,
  mailDraftSchema,
  reminderSubject,
  todayInPrague,
  type DateOnly,
  type ReminderPreview,
  type Role,
} from "@bystro/core";
import {
  encrypt,
  getInvoiceDetail,
  listActions,
  listInvoiceReminders,
  proposeAction,
  updateProposedActionPreview,
  type Db,
  type StoredAction,
} from "@bystro/db";
import { z } from "zod";

import { decideOnAction, DECIDING_ROLES, type EnqueueExecution } from "./actions";
import { findMailbox } from "./mail";

/**
 * Reminders on the invoice detail: the user sends (or turns down) the reminder Bystro
 * proposed, or one they ask for themselves. Sending is the approval of the action; the
 * text is stored only encrypted.
 */

export const reminderRequestSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("dismiss") }),
  z.object({
    decision: z.literal("send"),
    to: z.string(),
    subject: z.string(),
    body: z.string(),
    attachPdf: z.boolean(),
  }),
]);
export type ReminderRequest = z.infer<typeof reminderRequestSchema>;

export interface ReminderDeps {
  db: Db;
  encryptionKey: Buffer;
  enqueue: EnqueueExecution;
  now?: Date;
}

export type ReminderResult =
  | { ok: true; actionId: string | null; status: string | null }
  | {
      ok: false;
      error: "forbidden" | "invalid" | "not_found" | "not_overdue" | "no_mailbox" | "conflict";
    };

const OPEN: ReadonlySet<StoredAction["status"]> = new Set(["proposed", "approved", "executing"]);
const SENT: ReadonlySet<StoredAction["status"]> = new Set(["succeeded", "verified"]);
/** A reminder the user asks for themselves waits this long at most. */
const MANUAL_VALID_MS = 24 * 60 * 60 * 1000;

export interface ReminderState {
  /** Waiting for the user (`proposed`) or on its way (`approved`, `executing`). */
  open: StoredAction | null;
  /** Reminders that went out, newest first. */
  sent: StoredAction[];
}

export async function loadReminderState(
  db: Db,
  organizationId: string,
  invoiceId: string,
): Promise<ReminderState> {
  const all = await listInvoiceReminders(db, organizationId, invoiceId);
  return {
    open: all.find((action) => OPEN.has(action.status)) ?? null,
    sent: all.filter((action) => SENT.has(action.status)),
  };
}

/** Reads "Jana Nová <jana@x.cz>, b@y.cz"; `null` if a part is not an address. */
function parseRecipients(value: string) {
  const parts = value
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const recipients = parts.map((part) => {
    const angle = /^(.*)<([^<>]+)>$/.exec(part);
    const name = angle?.[1]?.trim().replace(/^"|"$/g, "") ?? "";
    return { name: name === "" ? null : name, address: (angle?.[2] ?? part).trim() };
  });
  return recipients;
}

export async function handleReminder(
  deps: ReminderDeps,
  who: { organizationId: string; userId: string; role: Role | null },
  invoiceId: string,
  request: ReminderRequest,
): Promise<ReminderResult> {
  if (who.role === null || !DECIDING_ROLES.has(who.role)) {
    return { ok: false, error: "forbidden" };
  }
  const now = deps.now ?? new Date();
  const detail = await getInvoiceDetail(deps.db, who.organizationId, invoiceId);
  if (detail === null) {
    return { ok: false, error: "not_found" };
  }
  const { invoice, payments } = detail;
  const [row] = buildInvoiceRows(
    [
      {
        id: invoice.id,
        number: invoice.number,
        kind: invoice.kind,
        sourceStatus: invoice.sourceStatus,
        issuedOn: invoice.issuedOn as DateOnly,
        dueOn: invoice.dueOn as DateOnly,
        paidOn: invoice.paidOn as DateOnly | null,
        currency: invoice.currency,
        totalMinor: invoice.totalMinor,
        paidMinor: payments
          .filter((payment) => payment.currency === invoice.currency)
          .reduce((sum, payment) => sum + payment.amountMinor, 0n),
        clientName: detail.company?.name ?? null,
      },
    ],
    todayInPrague(now),
  );
  const state = await loadReminderState(deps.db, who.organizationId, invoiceId);
  const decide = (actionId: string, decision: "approved" | "rejected") =>
    decideOnAction(
      { db: deps.db, enqueue: deps.enqueue, now },
      {
        organizationId: who.organizationId,
        userId: who.userId,
        role: who.role,
        actionId,
        decision,
      },
    );

  if (request.decision === "dismiss") {
    if (state.open === null || state.open.status !== "proposed") {
      return { ok: true, actionId: null, status: null };
    }
    const decided = await decide(state.open.id, "rejected");
    return decided.ok
      ? { ok: true, actionId: state.open.id, status: decided.view.status }
      : { ok: false, error: "conflict" };
  }

  if (row?.status !== "overdue") {
    return { ok: false, error: "not_overdue" };
  }
  if ((await findMailbox(deps.db, who.organizationId)) === null) {
    return { ok: false, error: "no_mailbox" };
  }
  const draft = mailDraftSchema.safeParse({
    to: parseRecipients(request.to),
    cc: [],
    subject: request.subject,
    body: request.body,
  });
  if (!draft.success || draft.data.body.trim() === "") {
    return { ok: false, error: "invalid" };
  }
  if (state.open !== null && state.open.status !== "proposed") {
    // Already on its way (a double click): nothing new happens.
    return { ok: true, actionId: state.open.id, status: state.open.status };
  }

  const preview: ReminderPreview = {
    to: draft.data.to,
    subject: draft.data.subject,
    bodyEncrypted: encrypt(draft.data.body, deps.encryptionKey),
    attachPdf: request.attachPdf,
  };
  let actionId: string;
  if (state.open === null) {
    // The user asks for a reminder Bystro did not propose (yet).
    const { action } = await proposeAction(deps.db, who.organizationId, {
      type: "invoice_reminder",
      triggerCode: "user_requested",
      triggerData: { daysOverdue: row.daysOverdue },
      sources: [{ type: "invoice", id: invoice.id }],
      preview: {
        to: [],
        subject: reminderSubject(invoice.number),
        bodyEncrypted: null,
        attachPdf: true,
      },
      approvalLevel: "user",
      expiresAt: new Date(now.getTime() + MANUAL_VALID_MS),
      idempotencyKey: `invoice_reminder:${invoice.id}:user:${todayInPrague(now)}`,
      proposedBy: { type: "user", userId: who.userId },
      source: "web",
    });
    actionId = action.id;
  } else {
    actionId = state.open.id;
  }
  const updated = await updateProposedActionPreview(
    deps.db,
    who.organizationId,
    actionId,
    preview as unknown as { [key: string]: string },
    { userId: who.userId, source: "web" },
  );
  if (updated === null) {
    return { ok: false, error: "conflict" };
  }
  const decided = await decide(actionId, "approved");
  if (!decided.ok) {
    return { ok: false, error: decided.error === "source_changed" ? "not_overdue" : "conflict" };
  }
  return { ok: true, actionId, status: decided.view.status };
}

/**
 * The last day each invoice of the organization was reminded (a reminder went out), for
 * the "Připomenuto" status in the list.
 */
export async function loadRemindedOn(db: Db, organizationId: string): Promise<Map<string, string>> {
  const sent = await listActions(db, organizationId, { statuses: ["succeeded", "verified"] });
  const result = new Map<string, string>();
  for (const action of sent) {
    const invoice = action.sources.find((item) => item.type === "invoice");
    if (action.type !== "invoice_reminder" || invoice === undefined || action.executedAt === null) {
      continue;
    }
    const on = todayInPrague(action.executedAt);
    if ((result.get(invoice.id) ?? "") < on) result.set(invoice.id, on);
  }
  return result;
}

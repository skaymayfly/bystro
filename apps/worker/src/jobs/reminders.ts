import {
  buildInvoiceRows,
  formatDate,
  reminderSubject,
  shouldProposeReminder,
  todayInPrague,
  type EmptyPayload,
  type InvoiceDocument,
  type ReminderPreview,
} from "@bystro/core";
import {
  forOrganization,
  getConnection,
  getInvoiceDetail,
  listConnections,
  listInvoiceOverview,
  listInvoiceReminders,
  proposeAction,
  readConnectionTokens,
  type Db,
} from "@bystro/db";
import { freshConnectionTokens, GMAIL_SOURCE, withRequestHook } from "@bystro/integrations";

import type { JobHandler } from "../processing";
import type { RateLimiter } from "../rate-limiter";
import type { InvoiceDocumentFetcher } from "./send-mail";
import type { InvoiceProviderResolver } from "./sync-invoices";

const DAY_MS = 24 * 60 * 60 * 1000;
const SYSTEM = { type: "system" as const };

export interface ProposeRemindersDeps {
  db: Db;
  /** Organizations that have an invoicing system connected (identifiers only). */
  listOrganizations: () => Promise<string[]>;
  now?: () => Date;
}

/**
 * Proposes a reminder for every invoice that is overdue long enough, has a client e-mail
 * and was not reminded (or proposed, or turned down) within the company's repeat period.
 * Only companies with a connected Gmail get proposals: that is where reminders are sent
 * from. The key contains the invoice and the day, so a repeated run adds nothing.
 */
export function proposeRemindersHandler(deps: ProposeRemindersDeps): JobHandler<EmptyPayload> {
  const now = deps.now ?? (() => new Date());
  const { db } = deps;

  return async ({ logger }) => {
    const moment = now();
    const today = todayInPrague(moment);
    let proposed = 0;
    for (const organizationId of [...new Set(await deps.listOrganizations())]) {
      const organization = await forOrganization(db, organizationId).getOrganization();
      const mailbox = (await listConnections(db, organizationId)).find(
        (connection) => connection.provider === GMAIL_SOURCE && connection.status !== "revoked",
      );
      if (organization === null || mailbox === undefined) continue;
      const settings = {
        afterDays: organization.reminderAfterDays,
        repeatDays: organization.reminderRepeatDays,
      };

      const overdue = buildInvoiceRows(await listInvoiceOverview(db, organizationId), today).filter(
        (row) => row.status === "overdue",
      );
      for (const row of overdue) {
        const detail = await getInvoiceDetail(db, organizationId, row.id);
        if (detail === null || detail.invoice.direction !== "issued") continue;
        const email = detail.company?.email ?? null;
        const [last] = await listInvoiceReminders(db, organizationId, row.id);
        const candidate = {
          daysOverdue: row.daysOverdue,
          clientEmail: email,
          lastReminderAt: last?.createdAt ?? null,
        };
        if (email === null || !shouldProposeReminder(candidate, settings, moment)) continue;

        const preview: ReminderPreview = {
          to: [{ name: detail.company?.name ?? null, address: email }],
          subject: reminderSubject(row.number),
          bodyEncrypted: null,
          attachPdf: true,
        };
        const { created } = await proposeAction(db, organizationId, {
          type: "invoice_reminder",
          triggerCode: "invoice_overdue",
          triggerData: { daysOverdue: row.daysOverdue, dueOn: formatDate(row.dueOn) },
          sources: [{ type: "invoice", id: row.id }],
          preview,
          approvalLevel: "user",
          expiresAt: new Date(moment.getTime() + settings.repeatDays * DAY_MS),
          idempotencyKey: `invoice_reminder:${row.id}:${today}`,
          proposedBy: SYSTEM,
          source: "worker",
        });
        if (created) proposed += 1;
      }
    }
    // Counts only: no names, numbers or amounts.
    logger.info({ proposed }, "Invoice reminders proposed");
  };
}

export interface DocumentFetcherDeps {
  db: Db;
  encryptionKey: Buffer;
  resolveProvider: InvoiceProviderResolver;
  rateLimiter: RateLimiter;
  now?: () => Date;
  fetch?: typeof fetch;
}

/**
 * Fetches an invoice's PDF from the invoicing system it came from, within that system's
 * request limit. `null` when the system cannot be used here or has no PDF yet.
 */
export function createInvoiceDocumentFetcher(deps: DocumentFetcherDeps): InvoiceDocumentFetcher {
  return async (organizationId, invoiceId): Promise<InvoiceDocument | null> => {
    const detail = await getInvoiceDetail(deps.db, organizationId, invoiceId);
    if (detail === null) return null;
    const connection = await getConnection(deps.db, organizationId, detail.invoice.connectionId);
    if (connection === null || connection.status === "revoked") return null;
    const setup = deps.resolveProvider(connection);
    const tokens = await readConnectionTokens(
      deps.db,
      organizationId,
      connection.id,
      deps.encryptionKey,
    );
    if (setup === null || tokens === null) return null;
    const current = await freshConnectionTokens(
      {
        db: deps.db,
        encryptionKey: deps.encryptionKey,
        now: deps.now ?? (() => new Date()),
        ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
      },
      connection,
      setup.oauth,
      tokens,
    );
    const provider = withRequestHook(setup.create(current), () =>
      deps.rateLimiter.require(setup.rateLimit.key, setup.rateLimit.limit),
    );
    return provider.getDocument(detail.invoice.externalId);
  };
}

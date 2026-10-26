import {
  ActionTransitionError,
  buildJobId,
  buildMimeMessage,
  mailSendPreviewSchema,
  messageIdForAction,
  reminderPreviewSchema,
  syncMailJob,
  toBase64Url,
  type EmptyPayload,
  type InvoiceDocument,
  type MailAttachment,
  type MailDraft,
  type MailThreading,
  type SyncMailPayload,
} from "@bystro/core";
import {
  applyActionEvent,
  decrypt,
  getAction,
  getConnection,
  listConnections,
  listStuckActions,
  readConnectionTokens,
  type Db,
  type IntegrationConnection,
  type StoredAction,
} from "@bystro/db";
import {
  findSentGmailMessage,
  freshConnectionTokens,
  GMAIL_SOURCE,
  GmailClient,
  gmailOAuthConfig,
  OAuthError,
  sendGmailMessage,
} from "@bystro/integrations";

import type { JobHandler } from "../processing";
import type { GmailSettings } from "../providers";
import type { ActionExecutor } from "./execute-action";

/** A failure of carrying out an action, with the short code stored on the action. */
class MailSendError extends Error {
  override name = "MailSendError";

  constructor(readonly code: string) {
    super(`Mail not sent: ${code}`);
  }
}

export interface MailSendDeps {
  db: Db;
  encryptionKey: Buffer;
  /** `null` when Gmail is not configured in this environment. */
  gmail: GmailSettings | null;
  /** Only for tests against a stand-in; defaults to Google. */
  gmailApiBaseUrl?: string;
  /** Asks for a mail sync, so that the sent message shows up in its thread. */
  enqueueMailSync?: (data: SyncMailPayload, jobId: string) => Promise<boolean>;
  now?: () => Date;
  fetch?: typeof fetch;
}

const SYSTEM = { actor: { type: "system" as const }, source: "worker" as const };

/**
 * The mailbox an action sends from: the connection recorded in its sources (a message
 * written in Pošta), or else the company's connected Gmail (a reminder).
 */
async function mailboxOf(db: Db, action: StoredAction): Promise<IntegrationConnection> {
  const source = action.sources.find((item) => item.type === "integration_connection");
  const connection =
    source !== undefined
      ? await getConnection(db, action.organizationId, source.id)
      : ((await listConnections(db, action.organizationId)).find(
          (item) => item.provider === GMAIL_SOURCE && item.status !== "revoked",
        ) ?? null);
  if (
    connection === null ||
    connection.provider !== GMAIL_SOURCE ||
    connection.status === "revoked" ||
    connection.externalAccountId === null
  ) {
    throw new MailSendError("mailbox_missing");
  }
  return connection;
}

/** A Gmail client for the connection, with a fresh access token. */
async function gmailFor(deps: MailSendDeps, connection: IntegrationConnection) {
  if (deps.gmail === null) {
    throw new MailSendError("provider_not_configured");
  }
  const tokens = await readConnectionTokens(
    deps.db,
    connection.organizationId,
    connection.id,
    deps.encryptionKey,
  );
  if (tokens === null) {
    throw new MailSendError("reauth_required");
  }
  const fetchOption = deps.fetch === undefined ? {} : { fetch: deps.fetch };
  try {
    const current = await freshConnectionTokens(
      {
        db: deps.db,
        encryptionKey: deps.encryptionKey,
        now: deps.now ?? (() => new Date()),
        ...fetchOption,
      },
      connection,
      gmailOAuthConfig(deps.gmail),
      tokens,
    );
    return new GmailClient({
      accessToken: current.accessToken,
      ...(deps.gmailApiBaseUrl === undefined ? {} : { apiBaseUrl: deps.gmailApiBaseUrl }),
      ...fetchOption,
    });
  } catch (error) {
    if (error instanceof OAuthError) {
      throw new MailSendError(
        error.code === "reauthorization_required" ? "reauth_required" : "provider_unavailable",
      );
    }
    throw error;
  }
}

interface OutgoingMail {
  draft: MailDraft;
  threading: MailThreading | null;
  attachments: MailAttachment[];
}

/**
 * Sends a message for an action from the company's Gmail, with a Message-ID derived from
 * the action. If a message with that Message-ID is already in Odeslané (a previous attempt
 * went out), it is not sent again. Returns Gmail's id of the sent message.
 */
async function sendForAction(
  deps: MailSendDeps,
  action: StoredAction,
  build: () => Promise<OutgoingMail>,
): Promise<{ resultReference: string }> {
  const now = deps.now ?? (() => new Date());
  const connection = await mailboxOf(deps.db, action);
  const client = await gmailFor(deps, connection);
  const address = connection.externalAccountId as string;
  const messageId = messageIdForAction(action.id, address);

  const already = await findSentGmailMessage(client, messageId);
  if (already !== null) {
    return { resultReference: already };
  }

  const mail = await build();
  const raw = buildMimeMessage({
    from: { name: null, address },
    draft: mail.draft,
    messageId,
    threading: mail.threading,
    date: now(),
    attachments: mail.attachments,
  });
  const sent = await sendGmailMessage(
    client,
    toBase64Url(raw),
    mail.threading?.threadExternalId ?? null,
  );

  // Best effort: the regular sync would pick the message up within minutes anyway.
  await deps
    .enqueueMailSync?.(
      { organizationId: action.organizationId, connectionId: connection.id, mode: "incremental" },
      buildJobId(syncMailJob.name, connection.id, "sent", action.id),
    )
    .catch(() => false);
  return { resultReference: sent.id };
}

/** Carries out a `mail_send` action: the e-mail the user wrote in Pošta. */
export function createMailSendExecutor(deps: MailSendDeps): ActionExecutor {
  return async (action) => {
    const preview = mailSendPreviewSchema.safeParse(action.preview);
    if (!preview.success) {
      throw new MailSendError("invalid_preview");
    }
    const { to, cc, subject, bodyEncrypted, threadExternalId, inReplyTo, references } =
      preview.data;
    return sendForAction(deps, action, async () => ({
      draft: { to, cc, subject, body: decrypt(bodyEncrypted, deps.encryptionKey) },
      threading: threadExternalId === null ? null : { threadExternalId, inReplyTo, references },
      attachments: [],
    }));
  };
}

/** Fetches the invoice's PDF from its invoicing system; `null` when it cannot be had now. */
export type InvoiceDocumentFetcher = (
  organizationId: string,
  invoiceId: string,
) => Promise<InvoiceDocument | null>;

/**
 * Carries out an `invoice_reminder` action: the reminder the user approved, with the
 * invoice's PDF attached when asked for and available. Without the PDF (not generated yet,
 * or the invoicing system is unavailable) the reminder still goes out.
 */
export function createInvoiceReminderExecutor(
  deps: MailSendDeps & { fetchDocument: InvoiceDocumentFetcher },
): ActionExecutor {
  return async (action) => {
    const preview = reminderPreviewSchema.safeParse(action.preview);
    const invoice = action.sources.find((item) => item.type === "invoice");
    if (!preview.success || preview.data.bodyEncrypted === null || invoice === undefined) {
      throw new MailSendError("invalid_preview");
    }
    const { to, subject, bodyEncrypted, attachPdf } = preview.data;
    return sendForAction(deps, action, async () => {
      const document = attachPdf
        ? await deps.fetchDocument(action.organizationId, invoice.id).catch(() => null)
        : null;
      return {
        draft: { to, cc: [], subject, body: decrypt(bodyEncrypted, deps.encryptionKey) },
        threading: null,
        attachments: document === null ? [] : [document],
      };
    });
  };
}

/** An action executing for longer than this has lost its worker. */
const STUCK_AFTER_MS = 15 * 60 * 1000;

/**
 * Settles e-mail actions (`mail_send`, `invoice_reminder`) whose worker stopped half-way: when the message is in
 * Odeslané it succeeded (with its id), otherwise it failed as `interrupted`. When Gmail
 * cannot be asked right now, the action is left for the next run. Never sends anything.
 */
export function recoverActionsHandler(deps: MailSendDeps): JobHandler<EmptyPayload> {
  const now = deps.now ?? (() => new Date());
  return async ({ logger }) => {
    const since = new Date(now().getTime() - STUCK_AFTER_MS);
    const stuck = [
      ...(await listStuckActions(deps.db, "mail_send", since)),
      ...(await listStuckActions(deps.db, "invoice_reminder", since)),
    ];
    let succeeded = 0;
    let failed = 0;
    let unknown = 0;
    for (const { organizationId, actionId } of stuck) {
      const action = await getAction(deps.db, organizationId, actionId);
      if (action === null || action.status !== "executing") continue;

      let sentId: string | null;
      try {
        const connection = await mailboxOf(deps.db, action);
        const client = await gmailFor(deps, connection);
        sentId = await findSentGmailMessage(
          client,
          messageIdForAction(action.id, connection.externalAccountId as string),
        );
      } catch (error) {
        if (error instanceof MailSendError && error.code === "mailbox_missing") {
          // The mailbox is gone: nothing can be checked any more, and nothing was proven sent.
          sentId = null;
        } else {
          // Gmail cannot be asked now (or this one action cannot be read): leave it for the
          // next run, and do not let it hold up the others.
          unknown += 1;
          continue;
        }
      }

      try {
        await applyActionEvent(
          deps.db,
          organizationId,
          actionId,
          sentId === null ? "fail" : "succeed",
          sentId === null
            ? { ...SYSTEM, now: now(), errorCode: "interrupted" }
            : { ...SYSTEM, now: now(), resultReference: sentId },
        );
        if (sentId === null) failed += 1;
        else succeeded += 1;
      } catch (error) {
        if (!(error instanceof ActionTransitionError)) throw error;
      }
    }
    logger.info(
      { stuck: stuck.length, succeeded, failed, unknown },
      "Interrupted mail actions settled",
    );
  };
}

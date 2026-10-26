import {
  ActionTransitionError,
  buildJobId,
  buildMimeMessage,
  mailSendPreviewSchema,
  messageIdForAction,
  ProviderError,
  syncMailJob,
  toBase64Url,
  type EmptyPayload,
  type SyncMailPayload,
} from "@bystro/core";
import {
  applyActionEvent,
  decrypt,
  getAction,
  getConnection,
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

/** The mailbox an action sends from: its connection, as recorded in the action's sources. */
async function mailboxOf(db: Db, action: StoredAction): Promise<IntegrationConnection> {
  const source = action.sources.find((item) => item.type === "integration_connection");
  const connection =
    source === undefined ? null : await getConnection(db, action.organizationId, source.id);
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

/**
 * Carries out a `mail_send` action: builds the message the user wrote, with a Message-ID
 * derived from the action, and sends it from the user's own mailbox. If a message with that
 * Message-ID is already in Odeslané (a previous attempt went out), it is not sent again.
 * The result is Gmail's id of the sent message. Nothing of the mail is logged.
 */
export function createMailSendExecutor(deps: MailSendDeps): ActionExecutor {
  const now = deps.now ?? (() => new Date());
  return async (action) => {
    const preview = mailSendPreviewSchema.safeParse(action.preview);
    if (!preview.success) {
      throw new MailSendError("invalid_preview");
    }
    const connection = await mailboxOf(deps.db, action);
    const client = await gmailFor(deps, connection);
    const address = connection.externalAccountId as string;
    const messageId = messageIdForAction(action.id, address);

    const already = await findSentGmailMessage(client, messageId);
    if (already !== null) {
      return { resultReference: already };
    }

    const { to, cc, subject, bodyEncrypted, threadExternalId, inReplyTo, references } =
      preview.data;
    const raw = buildMimeMessage({
      from: { name: null, address },
      draft: { to, cc, subject, body: decrypt(bodyEncrypted, deps.encryptionKey) },
      messageId,
      threading: threadExternalId === null ? null : { threadExternalId, inReplyTo, references },
      date: now(),
    });
    const sent = await sendGmailMessage(client, toBase64Url(raw), threadExternalId);

    // Best effort: the regular sync would pick the message up within minutes anyway.
    await deps
      .enqueueMailSync?.(
        { organizationId: action.organizationId, connectionId: connection.id, mode: "incremental" },
        buildJobId(syncMailJob.name, connection.id, "sent", action.id),
      )
      .catch(() => false);
    return { resultReference: sent.id };
  };
}

/** An action executing for longer than this has lost its worker. */
const STUCK_AFTER_MS = 15 * 60 * 1000;

/**
 * Settles `mail_send` actions whose worker stopped half-way: when the message is in
 * Odeslané it succeeded (with its id), otherwise it failed as `interrupted`. When Gmail
 * cannot be asked right now, the action is left for the next run. Never sends anything.
 */
export function recoverActionsHandler(deps: MailSendDeps): JobHandler<EmptyPayload> {
  const now = deps.now ?? (() => new Date());
  return async ({ logger }) => {
    const stuck = await listStuckActions(
      deps.db,
      "mail_send",
      new Date(now().getTime() - STUCK_AFTER_MS),
    );
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
        } else if (error instanceof MailSendError || error instanceof ProviderError) {
          unknown += 1;
          continue;
        } else {
          throw error;
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

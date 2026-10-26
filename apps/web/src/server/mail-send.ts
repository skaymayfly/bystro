import { mailDraftSchema, type MailSendPreview, type Role } from "@bystro/core";
import { encrypt, getAction, getMailThread, proposeAction, type Db } from "@bystro/db";
import { z } from "zod";

import { decideOnAction, DECIDING_ROLES, type EnqueueExecution } from "./actions";
import { findMailbox } from "./mail";

/**
 * Sending an e-mail from Pošta. Writing it and clicking Odeslat is the user's approval:
 * the click proposes a `mail_send` action and approves it in one go, and the worker sends
 * it, exactly once. The text is stored with the action only encrypted.
 */

/** What the composer sends. `clientKey` is made once per opened composer. */
export const sendMailRequestSchema = z.object({
  clientKey: z.uuid(),
  threadId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,100}$/)
    .nullable(),
  to: z.array(z.object({ name: z.string().nullable(), address: z.string() })),
  cc: z.array(z.object({ name: z.string().nullable(), address: z.string() })),
  subject: z.string(),
  body: z.string(),
});
export type SendMailRequest = z.infer<typeof sendMailRequestSchema>;

export interface SendMailDeps {
  db: Db;
  encryptionKey: Buffer;
  enqueue: EnqueueExecution;
  now?: Date;
}

export type SendMailResult =
  | { ok: true; actionId: string; status: string }
  | {
      ok: false;
      error: "forbidden" | "invalid" | "not_found" | "reauth_required" | "conflict";
    };

/** A message waits at most this long to be carried out; then it expires unsent. */
const VALID_FOR_MS = 60 * 60 * 1000;

export async function sendMail(
  deps: SendMailDeps,
  who: { organizationId: string; userId: string; role: Role | null },
  request: SendMailRequest,
): Promise<SendMailResult> {
  if (who.role === null || !DECIDING_ROLES.has(who.role)) {
    return { ok: false, error: "forbidden" };
  }
  const draft = mailDraftSchema.safeParse({
    to: request.to,
    cc: request.cc,
    subject: request.subject,
    body: request.body,
  });
  if (!draft.success) {
    return { ok: false, error: "invalid" };
  }
  const mailbox = await findMailbox(deps.db, who.organizationId);
  if (mailbox === null) {
    return { ok: false, error: "not_found" };
  }
  if (mailbox.status === "reauth_required") {
    return { ok: false, error: "reauth_required" };
  }

  let threading: Pick<MailSendPreview, "threadExternalId" | "inReplyTo" | "references"> = {
    threadExternalId: null,
    inReplyTo: null,
    references: [],
  };
  if (request.threadId !== null) {
    const thread = await getMailThread(
      deps.db,
      { organizationId: who.organizationId, connectionId: mailbox.id },
      request.threadId,
      deps.encryptionKey,
    );
    if (thread === null) {
      return { ok: false, error: "not_found" };
    }
    // The reply refers to the latest message of the thread, as mail clients do.
    const last = thread.messages.at(-1);
    threading = {
      threadExternalId: thread.externalId,
      inReplyTo: last?.messageIdHeader ?? null,
      references: last?.references ?? [],
    };
  }

  const preview: MailSendPreview = {
    to: draft.data.to,
    cc: draft.data.cc,
    subject: draft.data.subject,
    bodyEncrypted: encrypt(draft.data.body, deps.encryptionKey),
    ...threading,
  };
  const now = deps.now ?? new Date();
  const { action } = await proposeAction(deps.db, who.organizationId, {
    type: "mail_send",
    triggerCode: request.threadId === null ? "user_wrote" : "user_replied",
    sources: [
      { type: "integration_connection", id: mailbox.id },
      ...(request.threadId === null ? [] : [{ type: "mail_thread", id: request.threadId }]),
    ],
    preview: preview as unknown as { [key: string]: string },
    approvalLevel: "user",
    expiresAt: new Date(now.getTime() + VALID_FOR_MS),
    // One composer, one message: a double click or a repeated request finds this action.
    idempotencyKey: `mail_send:${who.userId}:${request.clientKey}`,
    proposedBy: { type: "user", userId: who.userId },
    source: "web",
  });

  const decided = await decideOnAction(
    { db: deps.db, enqueue: deps.enqueue, now },
    {
      organizationId: who.organizationId,
      userId: who.userId,
      role: who.role,
      actionId: action.id,
      decision: "approved",
    },
  );
  if (!decided.ok) {
    return {
      ok: false,
      error:
        decided.error === "forbidden" || decided.error === "not_found" ? decided.error : "conflict",
    };
  }
  return { ok: true, actionId: action.id, status: decided.view.status };
}

/** What the composer may know about its message while it is being sent. Never its text. */
export async function mailSendStatus(
  db: Db,
  organizationId: string,
  actionId: string,
): Promise<{ status: string; errorCode: string | null } | null> {
  const action = await getAction(db, organizationId, actionId);
  if (action === null || action.type !== "mail_send") {
    return null;
  }
  return { status: action.status, errorCode: action.errorCode };
}

/** A transactional e-mail sent by Bystro itself (password reset, morning brief, …). */
export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body; always required so every e-mail is readable without HTML. */
  text: string;
  html?: string;
  replyTo?: string;
  /** Sending twice with the same key must deliver at most one e-mail. */
  idempotencyKey?: string;
}

/** Outbound e-mail provider. Implementations live in `packages/integrations`. */
export interface EmailSender {
  /** Resolves with the provider's message ID, rejects when the e-mail was not accepted. */
  send(message: EmailMessage): Promise<{ id: string }>;
}

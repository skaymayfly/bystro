import { z } from "zod";

/**
 * Writing e-mail from Bystro: checking what the user wrote and turning it into an RFC 2822
 * message that Gmail sends as it is. Plain text only, UTF-8. Pure functions.
 *
 * Nothing the user typed may break the message's structure: line breaks in a header value
 * would let text become another header (header injection), so they are refused.
 */

export const MAX_MAIL_RECIPIENTS = 20;
export const MAX_MAIL_SUBJECT_CHARS = 500;
export const MAX_MAIL_TEXT_CHARS = 100_000;

const noLineBreaks = (value: string) => !/[\r\n]/.test(value);

const recipientSchema = z.object({
  name: z.string().max(200).refine(noLineBreaks).nullable(),
  address: z.email().max(320).refine(noLineBreaks),
});

/** What the user wrote, before Bystro adds its own headers. */
export const mailDraftSchema = z
  .object({
    to: z.array(recipientSchema).min(1),
    cc: z.array(recipientSchema),
    subject: z.string().trim().min(1).max(MAX_MAIL_SUBJECT_CHARS).refine(noLineBreaks),
    body: z.string().max(MAX_MAIL_TEXT_CHARS),
  })
  .refine((draft) => draft.to.length + draft.cc.length <= MAX_MAIL_RECIPIENTS, {
    message: `At most ${MAX_MAIL_RECIPIENTS} recipients.`,
  });
export type MailDraft = z.infer<typeof mailDraftSchema>;
export type MailRecipient = z.infer<typeof recipientSchema>;

/** A reply goes into its thread: Gmail needs the thread id, these headers and the subject. */
export interface MailThreading {
  threadExternalId: string;
  /** `Message-ID` of the message replied to. */
  inReplyTo: string | null;
  references: readonly string[];
}

/** "Re: Faktura" for a reply, without piling up "Re: Re:". */
export function replySubject(subject: string | null): string {
  const base = (subject ?? "").trim();
  if (base === "") return "Re:";
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}

/**
 * The `Message-ID` of the message an action sends. Derived from the action, so that
 * Bystro can later look for it in Odeslané and know whether it went out.
 */
export function messageIdForAction(actionId: string, mailboxAddress: string): string {
  const domain = mailboxAddress.split("@")[1] ?? "bystro.invalid";
  return `<bystro.${actionId}@${domain}>`;
}

const ASCII = /^[\x20-\x7e]*$/;

/** UTF-8 bytes as a binary string, for base64 without Node's Buffer. */
function utf8Binary(text: string): string {
  return Array.from(new TextEncoder().encode(text), (byte) => String.fromCharCode(byte)).join("");
}

/** RFC 2047 encoded word for a header value that is not plain ASCII. */
function encodeHeaderText(text: string): string {
  if (ASCII.test(text)) return text;
  // Split into chunks so that no encoded word is longer than the RFC allows (75 chars).
  const words: string[] = [];
  let chunk = "";
  for (const char of text) {
    if (utf8Binary(chunk + char).length > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk !== "") words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${btoa(utf8Binary(word))}?=`).join(" ");
}

function formatAddress(recipient: MailRecipient): string {
  if (recipient.name === null || recipient.name.trim() === "") return recipient.address;
  const name = recipient.name.trim();
  const display = ASCII.test(name)
    ? `"${name.replace(/(["\\])/g, "\\$1")}"`
    : encodeHeaderText(name);
  return `${display} <${recipient.address}>`;
}

/** RFC 5322 date, in UTC. */
function formatDate(date: Date): string {
  return date.toUTCString().replace("GMT", "+0000");
}

/** Base64 of the UTF-8 text, in lines of 76 characters. */
function base64Lines(text: string): string {
  const encoded = btoa(utf8Binary(text.replace(/\r?\n/g, "\r\n")));
  return encoded.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

export interface ComposedMail {
  from: MailRecipient;
  draft: MailDraft;
  messageId: string;
  threading: MailThreading | null;
  date: Date;
}

/**
 * The whole message as RFC 2822 text with CRLF line ends: headers, then the body as
 * UTF-8 plain text in base64. Throws if a header value contains a line break.
 */
export function buildMimeMessage(mail: ComposedMail): string {
  const draft = mailDraftSchema.parse(mail.draft);
  const headers: string[] = [
    `From: ${formatAddress(mail.from)}`,
    `To: ${draft.to.map(formatAddress).join(", ")}`,
  ];
  if (draft.cc.length > 0) headers.push(`Cc: ${draft.cc.map(formatAddress).join(", ")}`);
  headers.push(`Subject: ${encodeHeaderText(draft.subject.trim())}`);
  headers.push(`Date: ${formatDate(mail.date)}`);
  headers.push(`Message-ID: ${mail.messageId}`);
  if (mail.threading !== null) {
    if (mail.threading.inReplyTo !== null) {
      headers.push(`In-Reply-To: ${mail.threading.inReplyTo}`);
    }
    const references = [...mail.threading.references];
    if (mail.threading.inReplyTo !== null && !references.includes(mail.threading.inReplyTo)) {
      references.push(mail.threading.inReplyTo);
    }
    if (references.length > 0) headers.push(`References: ${references.join(" ")}`);
  }
  headers.push(
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  );
  for (const header of headers) {
    if (/[\r\n]/.test(header)) throw new RangeError("A header value contains a line break.");
  }
  return `${headers.join("\r\n")}\r\n\r\n${base64Lines(draft.body)}\r\n`;
}

/** Base64url without padding, as Gmail's `raw` field wants it. */
export function toBase64Url(text: string): string {
  return btoa(utf8Binary(text)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The preview of a `mail_send` action as stored with it: recipients and subject readable
 * (the user saw them when sending), the text encrypted with `ENCRYPTION_KEY` like all mail.
 */
export const mailSendPreviewSchema = z.object({
  to: z.array(recipientSchema).min(1),
  cc: z.array(recipientSchema),
  subject: z.string(),
  bodyEncrypted: z.string().min(1),
  threadExternalId: z.string().nullable(),
  inReplyTo: z.string().nullable(),
  references: z.array(z.string()),
});
export type MailSendPreview = z.infer<typeof mailSendPreviewSchema>;

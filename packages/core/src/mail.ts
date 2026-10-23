/**
 * E-mail from the user's own mailbox, independent of the provider (Gmail first). Pure
 * functions: reading addresses and MIME structure, the 30-day window, which messages
 * belong in Bystro and how a list of mailbox changes folds into one set of updates.
 *
 * Everything that comes out of a mailbox is untrusted text. Nothing here interprets it:
 * HTML is reduced to plain text and never kept, and no value is ever logged.
 */

/** How far back mail is kept; older messages are deleted, not just hidden. */
export const MAIL_WINDOW_DAYS = 30;

/** Longest body text kept per message; the rest is cut off. */
export const MAX_MAIL_BODY_CHARS = 100_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The oldest moment a kept message may have. */
export function mailWindowStart(now: Date): Date {
  return new Date(now.getTime() - MAIL_WINDOW_DAYS * DAY_MS);
}

// ---------------------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------------------

/**
 * The system labels Bystro cares about (Gmail's names). Other labels (the user's own,
 * categories, IMPORTANT, …) are not stored.
 */
export const MAIL_LABELS = ["INBOX", "SENT", "UNREAD", "TRASH", "SPAM", "DRAFT"] as const;
export type MailLabel = (typeof MAIL_LABELS)[number];

const TRACKED = new Set<string>(MAIL_LABELS);

/** Keeps only the tracked labels, without duplicates, in a stable order. */
export function trackedLabels(labelIds: readonly string[]): MailLabel[] {
  return MAIL_LABELS.filter((label) => labelIds.includes(label) && TRACKED.has(label));
}

/** Trashed and spam messages are removed from Bystro altogether. */
export function isDiscardedMail(labels: readonly string[]): boolean {
  return labels.includes("TRASH") || labels.includes("SPAM");
}

/**
 * Whether a newly seen message is fetched into Bystro: it is in Doručené or Odeslané and
 * is neither a draft, nor in the trash or spam. A message archived later stays.
 */
export function isMailInScope(labels: readonly string[]): boolean {
  return (
    (labels.includes("INBOX") || labels.includes("SENT")) &&
    !labels.includes("DRAFT") &&
    !isDiscardedMail(labels)
  );
}

// ---------------------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------------------

export interface MailAddress {
  /** Display name, if the header has one. */
  name: string | null;
  /** Lower-cased address. */
  address: string;
}

/** A message as an adapter delivers it, already reduced to what Bystro keeps. */
export interface MailMessage {
  /** Adapter identifier, e.g. "gmail". */
  source: string;
  externalId: string;
  threadExternalId: string;
  /** The provider's change marker of the message (Gmail `historyId`). */
  historyId: string | null;
  /** When the provider received or sent it; orders the mailbox. */
  receivedAt: Date;
  labels: MailLabel[];
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string | null;
  /** `Message-ID`, `In-Reply-To` and `References`: needed to reply within the thread. */
  messageIdHeader: string | null;
  inReplyTo: string | null;
  references: string[];
  /** Short preview from the provider. */
  snippet: string;
  /** Plain text of the body, at most {@link MAX_MAIL_BODY_CHARS}. */
  bodyText: string;
  hasAttachments: boolean;
}

// ---------------------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------------------

export interface MailHeader {
  name: string;
  value: string;
}

/** The value of the first header with this name (case-insensitive), or `null`. */
export function headerValue(headers: readonly MailHeader[], name: string): string | null {
  const wanted = name.toLowerCase();
  return headers.find((header) => header.name.toLowerCase() === wanted)?.value ?? null;
}

/** Base64 (standard or URL-safe, padding optional) to bytes; works in Node and browsers. */
function base64ToBytes(data: string): Uint8Array {
  const standard = data.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  const padded = standard + "=".repeat((4 - (standard.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function decoderFor(charset: string): { decode(input: Uint8Array): string } {
  try {
    return new TextDecoder(charset.trim().toLowerCase());
  } catch {
    return new TextDecoder("utf-8");
  }
}

function decodeQ(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (char === "_") {
      bytes.push(0x20);
    } else if (char === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(index + 1, index + 3))) {
      bytes.push(parseInt(text.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(char.charCodeAt(0) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;

/**
 * Decodes RFC 2047 encoded words (`=?utf-8?B?…?=`, `=?iso-8859-2?Q?…?=`). Providers
 * usually decode headers already; this catches the ones that arrive raw. Whitespace
 * between two encoded words is dropped, as the RFC says.
 */
export function decodeEncodedWords(value: string): string {
  const joined = value.replace(/\?=\s+=\?/g, "?==?");
  return joined.replace(ENCODED_WORD, (whole, charset: string, encoding: string, text: string) => {
    try {
      const bytes = encoding.toUpperCase() === "B" ? base64ToBytes(text) : decodeQ(text);
      return decoderFor(charset.split("*")[0] as string).decode(bytes);
    } catch {
      return whole;
    }
  });
}

/** Splits on commas that are outside quotes, angle brackets and comments. */
function splitAddressList(value: string): string[] {
  const items: string[] = [];
  let current = "";
  let quoted = false;
  let angle = 0;
  let comment = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] as string;
    if (char === "\\" && quoted) {
      current += char + (value[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (char === '"' && comment === 0) quoted = !quoted;
    else if (!quoted && char === "<") angle += 1;
    else if (!quoted && char === ">") angle = Math.max(0, angle - 1);
    else if (!quoted && char === "(") comment += 1;
    else if (!quoted && char === ")") comment = Math.max(0, comment - 1);
    if (char === "," && !quoted && angle === 0 && comment === 0) {
      items.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  items.push(current);
  return items.map((item) => item.trim()).filter((item) => item !== "");
}

const ADDRESS = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+$/;

function cleanName(name: string): string | null {
  let result = name.trim();
  if (result.startsWith('"') && result.endsWith('"') && result.length >= 2) {
    result = result.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  result = decodeEncodedWords(result).trim();
  return result === "" ? null : result;
}

/** Reads one mailbox: `Jana Nová <jana@example.cz>`, `jana@example.cz (Jana)`, `jana@example.cz`. */
function parseMailbox(item: string): MailAddress | null {
  const angle = /^(.*)<([^<>]+)>\s*(\(.*\))?$/.exec(item);
  if (angle !== null) {
    const address = (angle[2] as string).trim().toLowerCase();
    return ADDRESS.test(address) ? { name: cleanName(angle[1] as string), address } : null;
  }
  const comment = /^([^\s()]+)\s*\((.*)\)$/.exec(item);
  if (comment !== null) {
    const address = (comment[1] as string).toLowerCase();
    return ADDRESS.test(address) ? { name: cleanName(comment[2] as string), address } : null;
  }
  const address = item.trim().toLowerCase();
  return ADDRESS.test(address) ? { name: null, address } : null;
}

/**
 * Reads an address header (`From`, `To`, `Cc`). Group syntax (`Tým: a@x.cz, b@x.cz;`) is
 * flattened; anything that is not a valid address is left out.
 */
export function parseAddressList(value: string | null): MailAddress[] {
  if (value === null) return [];
  const withoutGroups = value.replace(/[^,:"<>]*:([^;]*);/g, "$1");
  return splitAddressList(withoutGroups)
    .map(parseMailbox)
    .filter((item): item is MailAddress => item !== null);
}

/** The message ids in `References` / `In-Reply-To`: `<…>` tokens, in order. */
export function parseMessageIds(value: string | null): string[] {
  if (value === null) return [];
  return [...value.matchAll(/<[^<>\s]+>/g)].map((match) => match[0]);
}

// ---------------------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------------------

/** One node of a message's MIME tree, as a provider describes it. */
export interface MimePart {
  mimeType: string;
  headers: readonly MailHeader[];
  filename: string | null;
  /** Body bytes in base64url; `null` for containers and for attachments stored apart. */
  data: string | null;
  /** The body lives elsewhere (a separately fetched attachment). */
  hasExternalBody: boolean;
  parts: readonly MimePart[];
}

function charsetOf(part: MimePart): string {
  const contentType = headerValue(part.headers, "Content-Type") ?? "";
  const match = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType);
  return match?.[1] ?? "utf-8";
}

function partText(part: MimePart): string {
  if (part.data === null || part.data === "") return "";
  try {
    return decoderFor(charsetOf(part)).decode(base64ToBytes(part.data));
  } catch {
    // Broken encoding: the part is unreadable, not the whole message.
    return "";
  }
}

function isAttachment(part: MimePart): boolean {
  const disposition = headerValue(part.headers, "Content-Disposition") ?? "";
  return (part.filename !== null && part.filename !== "") || /^\s*attachment/i.test(disposition);
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  bdquo: "„",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  copy: "©",
  euro: "€",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith("#")) {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/**
 * Reduces HTML to readable plain text: no tags, no scripts or styles, line breaks where
 * blocks end, entities decoded, links kept only as their visible text. The result is
 * shown as text and never rendered as HTML.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, "")
    // Line breaks in the source mean nothing in HTML; only tags break lines.
    .replace(/\s+/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table|section|article)\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, "");
  return normalizeText(decodeEntities(text));
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0 ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface BodySearch {
  plain: string[];
  html: string[];
  hasAttachments: boolean;
}

function walk(part: MimePart, found: BodySearch): void {
  if (isAttachment(part) || part.hasExternalBody) {
    found.hasAttachments = true;
    return;
  }
  const type = part.mimeType.toLowerCase();
  if (type === "text/plain") found.plain.push(partText(part));
  else if (type === "text/html") found.html.push(partText(part));
  for (const child of part.parts) walk(child, found);
}

/**
 * The readable text of a message: the plain-text parts if there are any, otherwise the
 * HTML parts reduced to text. Attachments are only noted, never read.
 */
export function extractMailText(root: MimePart): { text: string; hasAttachments: boolean } {
  const found: BodySearch = { plain: [], html: [], hasAttachments: false };
  walk(root, found);
  const plain = normalizeText(found.plain.join("\n\n"));
  const text = plain !== "" ? plain : htmlToText(found.html.join("\n"));
  return { text: text.slice(0, MAX_MAIL_BODY_CHARS), hasAttachments: found.hasAttachments };
}

// ---------------------------------------------------------------------------------------
// Mailbox changes
// ---------------------------------------------------------------------------------------

/** One change record from the provider's history, reduced to message ids and labels. */
export interface MailHistoryRecord {
  added: readonly { id: string; labels: readonly string[] }[];
  deleted: readonly string[];
  labelsAdded: readonly { id: string; labels: readonly string[] }[];
  labelsRemoved: readonly { id: string; labels: readonly string[] }[];
}

export interface MailChanges {
  /** New messages, with the labels they had when added. */
  added: Map<string, MailLabel[]>;
  /** Permanently deleted at the provider. */
  deleted: Set<string>;
  /** Label changes of messages that may already be stored, in order of arrival. */
  labelChanges: Map<string, { add: Set<MailLabel>; remove: Set<MailLabel> }>;
}

/**
 * Folds history records (oldest first) into one set of changes. A later record wins: a
 * label added and then removed ends up removed, and a deleted message drops out of
 * everything else.
 */
export function foldMailHistory(records: readonly MailHistoryRecord[]): MailChanges {
  const changes: MailChanges = { added: new Map(), deleted: new Set(), labelChanges: new Map() };
  const labelChange = (id: string) => {
    let entry = changes.labelChanges.get(id);
    if (entry === undefined) {
      entry = { add: new Set(), remove: new Set() };
      changes.labelChanges.set(id, entry);
    }
    return entry;
  };

  for (const record of records) {
    for (const message of record.added) {
      changes.deleted.delete(message.id);
      changes.added.set(message.id, trackedLabels(message.labels));
    }
    for (const message of record.labelsAdded) {
      const entry = labelChange(message.id);
      for (const label of trackedLabels(message.labels)) {
        entry.add.add(label);
        entry.remove.delete(label);
      }
    }
    for (const message of record.labelsRemoved) {
      const entry = labelChange(message.id);
      for (const label of trackedLabels(message.labels)) {
        entry.remove.add(label);
        entry.add.delete(label);
      }
    }
    for (const id of record.deleted) {
      changes.added.delete(id);
      changes.labelChanges.delete(id);
      changes.deleted.add(id);
    }
  }

  // A message added within this batch carries its final labels with it.
  for (const [id, labels] of changes.added) {
    const entry = changes.labelChanges.get(id);
    if (entry === undefined) continue;
    changes.added.set(id, applyLabelChange(labels, entry));
    changes.labelChanges.delete(id);
  }
  return changes;
}

/** The labels after a change: removals and additions applied to the current set. */
export function applyLabelChange(
  current: readonly string[],
  change: { add: ReadonlySet<MailLabel>; remove: ReadonlySet<MailLabel> },
): MailLabel[] {
  const result = new Set(trackedLabels(current));
  for (const label of change.remove) result.delete(label);
  for (const label of change.add) result.add(label);
  return trackedLabels([...result]);
}

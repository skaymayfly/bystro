import {
  extractMailText,
  headerValue,
  parseAddressList,
  parseMessageIds,
  ProviderError,
  trackedLabels,
  type MailHeader,
  type MailHistoryRecord,
  type MailLabel,
  type MailMessage,
  type MimePart,
} from "@bystro/core";
import { z } from "zod";

import { getGmailProfile, GMAIL_SOURCE, GmailNotFoundError, type GmailClient } from "./gmail";

/**
 * Reading a Gmail mailbox. Documentation (read 2026-10-24):
 * - Synchronization guide: https://developers.google.com/workspace/gmail/api/guides/sync
 * - users.messages.list / get, the Message resource and Format:
 *   https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages
 * - users.history.list: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list
 * - Quota units: https://developers.google.com/workspace/gmail/api/reference/quota
 *
 * Nothing read here is logged or put into an error; errors carry codes only.
 */

/** Quota units per call, from Google's quota table. */
export const GMAIL_COST = {
  list: 5,
  modifyThread: 10,
  getFull: 60,
  getMinimal: 20,
  history: 2,
  profile: 1,
} as const;

/** Most ids a list or history page may return (the API's maximum). */
const PAGE_SIZE = "500";

const listSchema = z.object({
  messages: z.array(z.object({ id: z.string(), threadId: z.string() })).optional(),
  nextPageToken: z.string().optional(),
});

export interface GmailMessageRef {
  id: string;
  threadId: string;
}

/**
 * One page of message ids (`messages.list`), e.g. Doručené of the last 30 days with
 * `labelIds: ["INBOX"]` and `q: "newer_than:30d"`. Trash and spam are left out unless a
 * label asks for them.
 */
export async function listGmailMessages(
  client: GmailClient,
  options: { labelId: string; query?: string; pageToken?: string | null },
): Promise<{ messages: GmailMessageRef[]; nextPageToken: string | null }> {
  const query: Record<string, string> = { labelIds: options.labelId, maxResults: PAGE_SIZE };
  if (options.query !== undefined) query.q = options.query;
  if (options.labelId === "TRASH" || options.labelId === "SPAM") query.includeSpamTrash = "true";
  if (options.pageToken !== undefined && options.pageToken !== null) {
    query.pageToken = options.pageToken;
  }
  const parsed = listSchema.safeParse(await client.getJson("/messages", query, GMAIL_COST.list));
  if (!parsed.success) {
    throw new ProviderError("invalid_response");
  }
  return {
    messages: parsed.data.messages ?? [],
    nextPageToken: parsed.data.nextPageToken ?? null,
  };
}

const headerSchema = z.object({ name: z.string(), value: z.string() });

interface RawPart {
  mimeType?: string | undefined;
  filename?: string | undefined;
  headers?: { name: string; value: string }[] | undefined;
  body?: { data?: string | undefined; attachmentId?: string | undefined } | undefined;
  parts?: RawPart[] | undefined;
}

const partSchema: z.ZodType<RawPart> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(headerSchema).optional(),
    body: z.object({ data: z.string().optional(), attachmentId: z.string().optional() }).optional(),
    parts: z.array(partSchema).optional(),
  }),
);

const messageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).optional(),
  snippet: z.string().optional(),
  historyId: z.string().optional(),
  internalDate: z.string().regex(/^\d+$/),
  payload: partSchema.optional(),
});

function toMimePart(part: RawPart): MimePart {
  return {
    mimeType: part.mimeType ?? "application/octet-stream",
    headers: part.headers ?? [],
    filename: part.filename === undefined || part.filename === "" ? null : part.filename,
    data: part.body?.data ?? null,
    hasExternalBody: part.body?.attachmentId !== undefined,
    parts: (part.parts ?? []).map(toMimePart),
  };
}

const cleanHeader = (headers: readonly MailHeader[], name: string): string | null => {
  const value = headerValue(headers, name)?.replace(/\s+/g, " ").trim() ?? null;
  return value === "" ? null : value;
};

/**
 * One whole message (`messages.get`, `format=full`), reduced to what Bystro keeps.
 * Returns `null` when the message no longer exists (deleted since it was listed).
 */
export async function getGmailMessage(
  client: GmailClient,
  id: string,
): Promise<MailMessage | null> {
  let body: unknown;
  try {
    body = await client.getJson(
      `/messages/${encodeURIComponent(id)}`,
      { format: "full" },
      GMAIL_COST.getFull,
    );
  } catch (error) {
    if (error instanceof GmailNotFoundError) return null;
    throw error;
  }
  const parsed = messageSchema.safeParse(body);
  if (!parsed.success) {
    throw new ProviderError("invalid_response");
  }
  const message = parsed.data;
  const root = toMimePart(message.payload ?? {});
  const headers = root.headers;
  const { text, hasAttachments } = extractMailText(root);
  const [from] = parseAddressList(headerValue(headers, "From"));

  return {
    source: GMAIL_SOURCE,
    externalId: message.id,
    threadExternalId: message.threadId,
    historyId: message.historyId ?? null,
    receivedAt: new Date(Number(message.internalDate)),
    labels: trackedLabels(message.labelIds ?? []),
    from: from ?? null,
    to: parseAddressList(headerValue(headers, "To")),
    cc: parseAddressList(headerValue(headers, "Cc")),
    subject: cleanHeader(headers, "Subject"),
    messageIdHeader: parseMessageIds(headerValue(headers, "Message-ID"))[0] ?? null,
    inReplyTo: parseMessageIds(headerValue(headers, "In-Reply-To"))[0] ?? null,
    references: parseMessageIds(headerValue(headers, "References")),
    snippet: message.snippet ?? "",
    bodyText: text,
    hasAttachments,
  };
}

const historyMessageSchema = z.object({
  id: z.string(),
  labelIds: z.array(z.string()).optional(),
});
const historyEntrySchema = z.object({ message: historyMessageSchema });
const labelEntrySchema = z.object({
  message: historyMessageSchema,
  labelIds: z.array(z.string()).optional(),
});

const historySchema = z.object({
  history: z
    .array(
      z.object({
        messagesAdded: z.array(historyEntrySchema).optional(),
        messagesDeleted: z.array(historyEntrySchema).optional(),
        labelsAdded: z.array(labelEntrySchema).optional(),
        labelsRemoved: z.array(labelEntrySchema).optional(),
      }),
    )
    .optional(),
  nextPageToken: z.string().optional(),
  historyId: z.string().regex(/^\d+$/),
});

/** The history id is too old: Gmail no longer has the changes since then. */
export class MailHistoryExpiredError extends Error {
  override name = "MailHistoryExpiredError";
}

/**
 * One page of mailbox changes since `startHistoryId` (`history.list`), oldest first.
 * Throws {@link MailHistoryExpiredError} on Gmail's 404 for an out-of-date id; the caller
 * then has to sync everything again.
 */
export async function listGmailHistory(
  client: GmailClient,
  startHistoryId: string,
  pageToken: string | null,
): Promise<{ records: MailHistoryRecord[]; nextPageToken: string | null; historyId: string }> {
  const query: Record<string, string | string[]> = {
    startHistoryId,
    maxResults: PAGE_SIZE,
    historyTypes: ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"],
  };
  if (pageToken !== null) query.pageToken = pageToken;
  let body: unknown;
  try {
    body = await client.getJson("/history", query, GMAIL_COST.history);
  } catch (error) {
    if (error instanceof GmailNotFoundError) throw new MailHistoryExpiredError("History expired.");
    throw error;
  }
  const parsed = historySchema.safeParse(body);
  if (!parsed.success) {
    throw new ProviderError("invalid_response");
  }
  const labelled = (entries: z.infer<typeof labelEntrySchema>[] | undefined) =>
    (entries ?? []).map((entry) => ({ id: entry.message.id, labels: entry.labelIds ?? [] }));

  return {
    records: (parsed.data.history ?? []).map((record) => ({
      added: (record.messagesAdded ?? []).map((entry) => ({
        id: entry.message.id,
        labels: entry.message.labelIds ?? [],
      })),
      deleted: (record.messagesDeleted ?? []).map((entry) => entry.message.id),
      labelsAdded: labelled(record.labelsAdded),
      labelsRemoved: labelled(record.labelsRemoved),
    })),
    nextPageToken: parsed.data.nextPageToken ?? null,
    historyId: parsed.data.historyId,
  };
}

/**
 * Archives a thread in Gmail (`threads.modify` without the INBOX label): every message of
 * the thread leaves Doručené, nothing is deleted. Documentation (read 2026-10-24):
 * https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/modify
 * Returns `false` when the thread no longer exists in the mailbox.
 */
export async function archiveGmailThread(client: GmailClient, threadId: string): Promise<boolean> {
  try {
    await client.postJson(
      `/threads/${encodeURIComponent(threadId)}/modify`,
      { removeLabelIds: ["INBOX"] },
      GMAIL_COST.modifyThread,
    );
    return true;
  } catch (error) {
    if (error instanceof GmailNotFoundError) return false;
    throw error;
  }
}

/** What the mail sync needs from a mailbox, whatever the provider. */
export interface MailboxReader {
  readonly source: string;
  /** The mailbox's current change marker; a full sync continues from it afterwards. */
  currentHistoryId(): Promise<string>;
  /** Ids of messages carrying `label` and received in the last `days` days, page by page. */
  listMessageIds(
    label: MailLabel,
    days: number,
    pageToken: string | null,
  ): Promise<{ ids: string[]; nextPageToken: string | null }>;
  /** The whole message, or `null` when it no longer exists. */
  getMessage(id: string): Promise<MailMessage | null>;
  /** Changes since `startHistoryId`; throws {@link MailHistoryExpiredError} when too old. */
  listChanges(
    startHistoryId: string,
    pageToken: string | null,
  ): Promise<{ records: MailHistoryRecord[]; nextPageToken: string | null; historyId: string }>;
}

/** {@link MailboxReader} over the Gmail API. */
export class GmailMailbox implements MailboxReader {
  readonly source = GMAIL_SOURCE;

  constructor(private readonly client: GmailClient) {}

  async currentHistoryId(): Promise<string> {
    return (await getGmailProfile(this.client)).historyId;
  }

  async listMessageIds(label: MailLabel, days: number, pageToken: string | null) {
    const page = await listGmailMessages(this.client, {
      labelId: label,
      query: `newer_than:${days}d`,
      pageToken,
    });
    return { ids: page.messages.map((message) => message.id), nextPageToken: page.nextPageToken };
  }

  getMessage(id: string): Promise<MailMessage | null> {
    return getGmailMessage(this.client, id);
  }

  listChanges(startHistoryId: string, pageToken: string | null) {
    return listGmailHistory(this.client, startHistoryId, pageToken);
  }
}

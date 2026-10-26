import { createHash } from "node:crypto";

import { trackedLabels, type MailLabel, type MailMessage } from "@bystro/core";
import { and, eq, inArray, lt, sql } from "drizzle-orm";

import type { Db, DbExecutor } from "./client";
import { decrypt, encrypt } from "./crypto";
import { requireUuid } from "./ids";
import type { SyncScope, UpsertCounts } from "./invoices";
import { mailMessages, mailThreads, type StoredMailAddress } from "./schema";

/**
 * Mail of one connected mailbox. Every function takes the organization (through the
 * scope) and filters by it. Writes are idempotent: a message is found by
 * `(organization_id, source, external_id)` and an unchanged one is not rewritten.
 *
 * The body and preview are encrypted before they reach the database. Mail is deleted
 * outright (older than the window, trashed, disconnected), never kept as soft-deleted.
 */

function validScope(scope: SyncScope): SyncScope {
  return {
    organizationId: requireUuid(scope.organizationId, "organizationId"),
    connectionId: requireUuid(scope.connectionId, "connectionId"),
  };
}

const ofConnection = (scope: SyncScope) =>
  and(
    eq(mailMessages.organizationId, scope.organizationId),
    eq(mailMessages.connectionId, scope.connectionId),
  );

/** Hash of the message as delivered, to skip rewriting (and re-encrypting) unchanged mail. */
function messageHash(message: MailMessage): string {
  return createHash("sha256")
    .update(JSON.stringify(message, (_key, value: unknown) => value))
    .digest("hex");
}

/** Labels of every stored message of the connection, by its external id. */
export async function listStoredMailLabels(
  db: Db,
  scope: SyncScope,
): Promise<Map<string, MailLabel[]>> {
  const valid = validScope(scope);
  const rows = await db
    .select({ externalId: mailMessages.externalId, labels: mailMessages.labels })
    .from(mailMessages)
    .where(ofConnection(valid));
  return new Map(rows.map((row) => [row.externalId, trackedLabels(row.labels)]));
}

/** Creates or updates messages; body and preview are encrypted with `encryptionKey`. */
export async function upsertMailMessages(
  db: Db,
  scope: SyncScope,
  messages: readonly MailMessage[],
  encryptionKey: Buffer,
): Promise<UpsertCounts> {
  const { organizationId, connectionId } = validScope(scope);
  const counts: UpsertCounts = { created: 0, updated: 0, unchanged: 0 };
  if (messages.length === 0) {
    return counts;
  }

  await db.transaction(async (tx) => {
    for (const source of [...new Set(messages.map((message) => message.source))]) {
      const batch = messages.filter((message) => message.source === source);
      const existing = await tx
        .select({
          id: mailMessages.id,
          externalId: mailMessages.externalId,
          rawHash: mailMessages.rawHash,
        })
        .from(mailMessages)
        .where(
          and(
            eq(mailMessages.organizationId, organizationId),
            eq(mailMessages.source, source),
            inArray(
              mailMessages.externalId,
              batch.map((message) => message.externalId),
            ),
          ),
        );
      const byExternalId = new Map(existing.map((row) => [row.externalId, row]));

      for (const message of batch) {
        const rawHash = messageHash(message);
        const stored = byExternalId.get(message.externalId);
        if (stored?.rawHash === rawHash) {
          counts.unchanged += 1;
          continue;
        }
        const values = {
          threadExternalId: message.threadExternalId,
          historyId: message.historyId,
          receivedAt: message.receivedAt,
          labels: trackedLabels(message.labels),
          fromName: message.from?.name ?? null,
          fromAddress: message.from?.address ?? null,
          toAddresses: message.to,
          ccAddresses: message.cc,
          subject: message.subject,
          messageIdHeader: message.messageIdHeader,
          inReplyTo: message.inReplyTo,
          references: message.references,
          snippetEncrypted: encrypt(message.snippet, encryptionKey),
          bodyEncrypted: encrypt(message.bodyText, encryptionKey),
          hasAttachments: message.hasAttachments,
          syncedAt: new Date(),
          rawHash,
        };
        if (stored === undefined) {
          await tx
            .insert(mailMessages)
            .values({
              organizationId,
              connectionId,
              source,
              externalId: message.externalId,
              ...values,
            })
            // Another run stored it meanwhile: the unique key keeps a single copy.
            .onConflictDoUpdate({
              target: [mailMessages.organizationId, mailMessages.source, mailMessages.externalId],
              set: values,
            });
          counts.created += 1;
        } else {
          await tx.update(mailMessages).set(values).where(eq(mailMessages.id, stored.id));
          counts.updated += 1;
        }
      }
    }
  });
  return counts;
}

/** Sets the labels of stored messages; unknown ids are ignored. Returns how many changed. */
export async function setMailLabels(
  db: Db,
  scope: SyncScope,
  updates: readonly { externalId: string; labels: readonly string[] }[],
): Promise<number> {
  const valid = validScope(scope);
  let changed = 0;
  if (updates.length === 0) {
    return changed;
  }
  await db.transaction(async (tx) => {
    for (const update of updates) {
      const rows = await tx
        .update(mailMessages)
        .set({ labels: trackedLabels(update.labels), syncedAt: new Date() })
        .where(and(ofConnection(valid), eq(mailMessages.externalId, update.externalId)))
        .returning({ id: mailMessages.id });
      changed += rows.length;
    }
  });
  return changed;
}

/** Deletes the given messages of the connection. Returns how many were removed. */
export async function deleteMailMessages(
  db: Db,
  scope: SyncScope,
  externalIds: readonly string[],
): Promise<number> {
  const valid = validScope(scope);
  if (externalIds.length === 0) {
    return 0;
  }
  const rows = await db
    .delete(mailMessages)
    .where(and(ofConnection(valid), inArray(mailMessages.externalId, [...externalIds])))
    .returning({ id: mailMessages.id });
  return rows.length;
}

/** Deletes messages received before `before` (the end of the window). */
export async function deleteMailReceivedBefore(
  db: Db,
  scope: SyncScope,
  before: Date,
): Promise<number> {
  const valid = validScope(scope);
  const rows = await db
    .delete(mailMessages)
    .where(and(ofConnection(valid), lt(mailMessages.receivedAt, before)))
    .returning({ id: mailMessages.id });
  return rows.length;
}

/**
 * Recomputes the thread summaries of the connection from its messages: one row per thread
 * that still has messages, none for threads that are gone.
 */
export async function refreshMailThreads(db: Db, scope: SyncScope): Promise<void> {
  const { organizationId, connectionId } = validScope(scope);
  await db.transaction(async (tx) => {
    await tx.delete(mailThreads).where(
      and(
        eq(mailThreads.organizationId, organizationId),
        eq(mailThreads.connectionId, connectionId),
        sql`not exists (
            select 1 from ${mailMessages}
            where ${mailMessages.organizationId} = ${mailThreads.organizationId}
              and ${mailMessages.connectionId} = ${mailThreads.connectionId}
              and ${mailMessages.source} = ${mailThreads.source}
              and ${mailMessages.threadExternalId} = ${mailThreads.externalId}
          )`,
      ),
    );
    await tx.execute(sql`
      insert into ${mailThreads} (
        organization_id, connection_id, source, external_id, subject, last_message_at,
        message_count, unread, in_inbox, has_sent, synced_at
      )
      select
        m.organization_id,
        m.connection_id,
        m.source,
        m.thread_external_id,
        (array_agg(m.subject order by m.received_at asc, m.external_id asc))[1],
        max(m.received_at),
        count(*)::int,
        bool_or('UNREAD' = any(m.labels)),
        bool_or('INBOX' = any(m.labels)),
        bool_or('SENT' = any(m.labels)),
        now()
      from ${mailMessages} m
      where m.organization_id = ${organizationId} and m.connection_id = ${connectionId}
      group by m.organization_id, m.connection_id, m.source, m.thread_external_id
      on conflict (organization_id, source, external_id) do update set
        subject = excluded.subject,
        last_message_at = excluded.last_message_at,
        message_count = excluded.message_count,
        unread = excluded.unread,
        in_inbox = excluded.in_inbox,
        has_sent = excluded.has_sent,
        synced_at = excluded.synced_at,
        updated_at = now()
    `);
  });
}

/** Removes all mail of a connection; used when the mailbox is disconnected. */
export async function deleteMailOfConnection(
  executor: DbExecutor,
  organizationId: string,
  connectionId: string,
): Promise<void> {
  const scope = validScope({ organizationId, connectionId });
  await executor.delete(mailMessages).where(ofConnection(scope));
  await executor
    .delete(mailThreads)
    .where(
      and(
        eq(mailThreads.organizationId, scope.organizationId),
        eq(mailThreads.connectionId, scope.connectionId),
      ),
    );
}

/** A stored message with its body decrypted; for the Pošta screen (step 5.5) and tests. */
export interface StoredMailMessage {
  externalId: string;
  threadExternalId: string;
  receivedAt: Date;
  labels: MailLabel[];
  fromAddress: string | null;
  subject: string | null;
  snippet: string;
  bodyText: string;
  hasAttachments: boolean;
}

/** Messages of the connection, newest first, with body and preview decrypted. */
export async function listMailMessages(
  db: Db,
  scope: SyncScope,
  encryptionKey: Buffer,
): Promise<StoredMailMessage[]> {
  const valid = validScope(scope);
  const rows = await db
    .select()
    .from(mailMessages)
    .where(ofConnection(valid))
    .orderBy(sql`${mailMessages.receivedAt} desc`, mailMessages.externalId);
  return rows.map((row) => ({
    externalId: row.externalId,
    threadExternalId: row.threadExternalId,
    receivedAt: row.receivedAt,
    labels: trackedLabels(row.labels),
    fromAddress: row.fromAddress,
    subject: row.subject,
    snippet: decrypt(row.snippetEncrypted, encryptionKey),
    bodyText: decrypt(row.bodyEncrypted, encryptionKey),
    hasAttachments: row.hasAttachments,
  }));
}

export type StoredMailThread = typeof mailThreads.$inferSelect;

/** Thread summaries of the connection, most recent first. */
export async function listMailThreads(db: Db, scope: SyncScope): Promise<StoredMailThread[]> {
  const valid = validScope(scope);
  return db
    .select()
    .from(mailThreads)
    .where(
      and(
        eq(mailThreads.organizationId, valid.organizationId),
        eq(mailThreads.connectionId, valid.connectionId),
      ),
    )
    .orderBy(sql`${mailThreads.lastMessageAt} desc`, mailThreads.externalId);
}

// ---------------------------------------------------------------------------------------
// Reading for the Pošta screen
// ---------------------------------------------------------------------------------------

export const MAIL_FOLDERS = ["inbox", "sent"] as const;
/** Doručené = a message of the thread is in INBOX; Odeslané = one was sent. */
export type MailFolder = (typeof MAIL_FOLDERS)[number];

export interface MailThreadListItem {
  externalId: string;
  subject: string | null;
  lastMessageAt: Date;
  messageCount: number;
  unread: boolean;
  hasAttachments: boolean;
  /** Who the thread is with: the last sender other than the user, or for Odeslané the recipient. */
  counterpart: StoredMailAddress | null;
  /** Preview of the last message, decrypted. */
  snippet: string;
}

const LIST_LIMIT = 100;

/** `%` and `_` are wildcards in LIKE; a search for them must find them literally. */
const likePattern = (query: string) => `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

/**
 * Threads of a folder, most recent first, optionally only those whose subject, sender or
 * recipients contain `query`. The body is encrypted and therefore not searched.
 */
export async function listMailFolder(
  db: Db,
  scope: SyncScope,
  options: { folder: MailFolder; query?: string; limit?: number },
  encryptionKey: Buffer,
): Promise<MailThreadListItem[]> {
  const valid = validScope(scope);
  const query = options.query?.trim() ?? "";
  const conditions = [
    eq(mailThreads.organizationId, valid.organizationId),
    eq(mailThreads.connectionId, valid.connectionId),
    options.folder === "inbox" ? eq(mailThreads.inInbox, true) : eq(mailThreads.hasSent, true),
  ];
  if (query !== "") {
    const pattern = likePattern(query);
    conditions.push(sql`exists (
      select 1 from ${mailMessages} m
      where m.organization_id = ${mailThreads.organizationId}
        and m.connection_id = ${mailThreads.connectionId}
        and m.thread_external_id = ${mailThreads.externalId}
        and (m.subject ilike ${pattern} or m.from_name ilike ${pattern}
          or m.from_address ilike ${pattern} or m.to_addresses::text ilike ${pattern}
          or m.cc_addresses::text ilike ${pattern})
    )`);
  }
  const threads = await db
    .select()
    .from(mailThreads)
    .where(and(...conditions))
    .orderBy(sql`${mailThreads.lastMessageAt} desc`, mailThreads.externalId)
    .limit(Math.min(options.limit ?? LIST_LIMIT, LIST_LIMIT));
  if (threads.length === 0) {
    return [];
  }

  const messages = await db
    .select({
      threadExternalId: mailMessages.threadExternalId,
      labels: mailMessages.labels,
      fromName: mailMessages.fromName,
      fromAddress: mailMessages.fromAddress,
      toAddresses: mailMessages.toAddresses,
      snippetEncrypted: mailMessages.snippetEncrypted,
      hasAttachments: mailMessages.hasAttachments,
    })
    .from(mailMessages)
    .where(
      and(
        ofConnection(valid),
        inArray(
          mailMessages.threadExternalId,
          threads.map((thread) => thread.externalId),
        ),
      ),
    )
    .orderBy(sql`${mailMessages.receivedAt} desc`, mailMessages.externalId);

  return threads.map((thread) => {
    const ofThread = messages.filter((message) => message.threadExternalId === thread.externalId);
    const last = ofThread[0];
    const lastSent = ofThread.find((message) => message.labels.includes("SENT"));
    // In Doručené the other side is whoever wrote last, not the user's own reply.
    const lastReceived = ofThread.find((message) => !message.labels.includes("SENT")) ?? last;
    const counterpart =
      options.folder === "sent"
        ? (lastSent?.toAddresses[0] ?? null)
        : lastReceived === undefined || lastReceived.fromAddress === null
          ? null
          : { name: lastReceived.fromName, address: lastReceived.fromAddress };
    return {
      externalId: thread.externalId,
      subject: thread.subject,
      lastMessageAt: thread.lastMessageAt,
      messageCount: thread.messageCount,
      unread: thread.unread,
      hasAttachments: ofThread.some((message) => message.hasAttachments),
      counterpart,
      snippet: last === undefined ? "" : decrypt(last.snippetEncrypted, encryptionKey),
    };
  });
}

/** How many messages of the connection are stored (progress of the first load). */
export async function countMailMessages(db: Db, scope: SyncScope): Promise<number> {
  const valid = validScope(scope);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mailMessages)
    .where(ofConnection(valid));
  return row?.count ?? 0;
}

/** How many threads in Doručené have an unread message. */
export async function countUnreadInboxThreads(db: Db, scope: SyncScope): Promise<number> {
  const valid = validScope(scope);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mailThreads)
    .where(
      and(
        eq(mailThreads.organizationId, valid.organizationId),
        eq(mailThreads.connectionId, valid.connectionId),
        eq(mailThreads.inInbox, true),
        eq(mailThreads.unread, true),
      ),
    );
  return row?.count ?? 0;
}

export interface MailThreadMessage {
  externalId: string;
  receivedAt: Date;
  labels: MailLabel[];
  from: StoredMailAddress | null;
  to: StoredMailAddress[];
  cc: StoredMailAddress[];
  subject: string | null;
  /** Plain text, decrypted. Untrusted: show as text only, never as HTML. */
  bodyText: string;
  hasAttachments: boolean;
  /** `Message-ID` and `References`: what a reply to this message refers to. */
  messageIdHeader: string | null;
  references: string[];
}

export interface MailThreadDetail {
  externalId: string;
  subject: string | null;
  inInbox: boolean;
  /** Oldest first. */
  messages: MailThreadMessage[];
}

/** One thread of the connection with its messages decrypted, or `null` if there is none. */
export async function getMailThread(
  db: Db,
  scope: SyncScope,
  threadExternalId: string,
  encryptionKey: Buffer,
): Promise<MailThreadDetail | null> {
  const valid = validScope(scope);
  const rows = await db
    .select()
    .from(mailMessages)
    .where(and(ofConnection(valid), eq(mailMessages.threadExternalId, threadExternalId)))
    .orderBy(mailMessages.receivedAt, mailMessages.externalId);
  const first = rows[0];
  if (first === undefined) {
    return null;
  }
  const messages = rows.map((row) => ({
    externalId: row.externalId,
    receivedAt: row.receivedAt,
    labels: trackedLabels(row.labels),
    from: row.fromAddress === null ? null : { name: row.fromName, address: row.fromAddress },
    to: row.toAddresses,
    cc: row.ccAddresses,
    subject: row.subject,
    bodyText: decrypt(row.bodyEncrypted, encryptionKey),
    hasAttachments: row.hasAttachments,
    messageIdHeader: row.messageIdHeader,
    references: row.references,
  }));
  return {
    externalId: threadExternalId,
    subject: first.subject,
    inInbox: messages.some((message) => message.labels.includes("INBOX")),
    messages,
  };
}

/**
 * Takes a thread out of Doručené in Bystro after it was archived at the provider. Returns
 * how many messages changed; 0 when the thread is unknown here.
 */
export async function archiveMailThread(
  db: Db,
  scope: SyncScope,
  threadExternalId: string,
): Promise<number> {
  const valid = validScope(scope);
  const rows = await db
    .update(mailMessages)
    .set({ labels: sql`array_remove(${mailMessages.labels}, 'INBOX')`, syncedAt: new Date() })
    .where(and(ofConnection(valid), eq(mailMessages.threadExternalId, threadExternalId)))
    .returning({ id: mailMessages.id });
  await refreshMailThreads(db, valid);
  return rows.length;
}

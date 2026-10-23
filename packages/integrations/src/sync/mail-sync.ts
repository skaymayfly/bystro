import {
  applyLabelChange,
  foldMailHistory,
  isDiscardedMail,
  isMailInScope,
  MAIL_WINDOW_DAYS,
  mailWindowStart,
  trackedLabels,
  type MailHistoryRecord,
  type MailLabel,
  type MailMessage,
} from "@bystro/core";
import {
  deleteMailMessages,
  deleteMailReceivedBefore,
  getSyncCursor,
  listStoredMailLabels,
  refreshMailThreads,
  setMailLabels,
  setSyncCursor,
  upsertMailMessages,
  type Db,
  type SyncScope,
} from "@bystro/db";

import { MailHistoryExpiredError, type MailboxReader } from "../gmail/mailbox";

/**
 * Keeps the last 30 days of Doručené and Odeslané of one mailbox in Bystro.
 *
 * - `full`: lists the window label by label (cheap: ids only), fetches the messages not yet
 *   stored, sets the labels of stored ones from the lists and removes trashed ones. The
 *   mailbox's change marker is read before listing, so nothing that changes meanwhile is
 *   missed. Also what the first sync and every sync after an expired history are.
 * - `incremental`: only the mailbox's changes since the stored marker.
 *
 * Idempotent: messages are matched by their external id. New messages are stored in small
 * batches, so a run that is interrupted keeps what it fetched and the next run goes on.
 * Messages that left the window are deleted at the end of every run.
 */

export const MAIL_SYNC_MODES = ["incremental", "full"] as const;
export type MailSyncMode = (typeof MAIL_SYNC_MODES)[number];

const CURSOR_RESOURCE = "mail";
/** Safety stop for a mailbox that keeps returning a next page. */
const MAX_PAGES = 200;
/** New messages are written in batches of this size. */
const STORE_BATCH = 20;
/** Labels listed in a full sync; what is not in any of them has none of them. */
const LISTED_LABELS: readonly MailLabel[] = ["INBOX", "SENT", "UNREAD", "TRASH", "SPAM"];

export interface MailSyncInput {
  db: Db;
  scope: SyncScope;
  reader: MailboxReader;
  mode: MailSyncMode;
  encryptionKey: Buffer;
  now?: Date;
  /**
   * Called after every stored batch with the number of messages stored so far in this run,
   * so that a long first load can report that it is alive.
   */
  onProgress?: (stored: number) => Promise<void>;
}

export interface MailSyncResult {
  /** The mode that actually ran: a first sync, or one after expired history, is `full`. */
  mode: MailSyncMode;
  /** The incremental run found the history expired and fell back to a full one. */
  historyExpired: boolean;
  created: number;
  updated: number;
  labelsChanged: number;
  deleted: number;
  /** Removed because they are older than the window. */
  expired: number;
}

/**
 * Orders message ids so that the newest come first. Gmail's ids are hexadecimal numbers
 * that grow over time, so a longer id, or a larger one of the same length, is newer. The
 * first load then fills Pošta from the top.
 */
function newestFirst(a: string, b: string): number {
  if (a.length !== b.length) return b.length - a.length;
  return a < b ? 1 : a > b ? -1 : 0;
}

export async function syncMail(input: MailSyncInput): Promise<MailSyncResult> {
  const { db, scope, reader, encryptionKey } = input;
  const now = input.now ?? new Date();
  const windowStart = mailWindowStart(now);
  const cursor = await getSyncCursor(db, scope.organizationId, scope.connectionId, CURSOR_RESOURCE);

  const result: MailSyncResult = {
    mode: cursor === null ? "full" : input.mode,
    historyExpired: false,
    created: 0,
    updated: 0,
    labelsChanged: 0,
    deleted: 0,
    expired: 0,
  };

  const pending: MailMessage[] = [];
  async function flush(): Promise<void> {
    if (pending.length === 0) return;
    const counts = await upsertMailMessages(db, scope, pending.splice(0), encryptionKey);
    result.created += counts.created;
    result.updated += counts.updated;
    // The batch shows up in Pošta right away, not only when the whole run is done.
    await refreshMailThreads(db, scope);
    await input.onProgress?.(result.created + result.updated);
  }

  /** Fetches a message and queues it if it belongs in Bystro. */
  async function fetchAndQueue(id: string): Promise<void> {
    const message = await reader.getMessage(id);
    if (message === null || !isMailInScope(message.labels) || message.receivedAt < windowStart) {
      return;
    }
    pending.push(message);
    if (pending.length >= STORE_BATCH) await flush();
  }

  async function full(): Promise<void> {
    const startHistoryId = await reader.currentHistoryId();
    const labelsById = new Map<string, Set<MailLabel>>();
    for (const label of LISTED_LABELS) {
      let pageToken: string | null = null;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const batch = await reader.listMessageIds(label, MAIL_WINDOW_DAYS, pageToken);
        for (const id of batch.ids) {
          const labels = labelsById.get(id) ?? new Set<MailLabel>();
          labels.add(label);
          labelsById.set(id, labels);
        }
        pageToken = batch.nextPageToken;
        if (pageToken === null) break;
      }
    }

    const stored = await listStoredMailLabels(db, scope);
    const discarded: string[] = [];
    const labelUpdates: { externalId: string; labels: MailLabel[] }[] = [];
    for (const [id, current] of stored) {
      const listed = trackedLabels([...(labelsById.get(id) ?? [])]);
      if (isDiscardedMail(listed)) {
        discarded.push(id);
      } else if (listed.join() !== current.join()) {
        labelUpdates.push({ externalId: id, labels: listed });
      }
    }
    result.deleted += await deleteMailMessages(db, scope, discarded);
    result.labelsChanged += await setMailLabels(db, scope, labelUpdates);

    const toFetch = [...labelsById]
      .filter(([id, labels]) => !stored.has(id) && isMailInScope([...labels]))
      .map(([id]) => id)
      .sort(newestFirst);
    try {
      for (const id of toFetch) {
        await fetchAndQueue(id);
      }
    } finally {
      // Keep what was fetched even if the run stops halfway; the next one goes on from here.
      await flush();
    }
    await setSyncCursor(
      db,
      scope.organizationId,
      scope.connectionId,
      CURSOR_RESOURCE,
      startHistoryId,
    );
  }

  async function incremental(startHistoryId: string): Promise<void> {
    const records: MailHistoryRecord[] = [];
    let latest = startHistoryId;
    let pageToken: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const batch = await reader.listChanges(startHistoryId, pageToken);
      records.push(...batch.records);
      latest = batch.historyId;
      pageToken = batch.nextPageToken;
      if (pageToken === null) break;
    }
    const changes = foldMailHistory(records);
    const stored = await listStoredMailLabels(db, scope);

    const discarded = [...changes.deleted].filter((id) => stored.has(id));
    const labelUpdates: { externalId: string; labels: MailLabel[] }[] = [];
    const toFetch: string[] = [];

    for (const [id, labels] of changes.added) {
      const current = stored.get(id);
      if (current !== undefined) {
        // Seen again (e.g. moved back from the trash): only its labels can have changed.
        if (isDiscardedMail(labels)) discarded.push(id);
        else if (labels.join() !== current.join()) labelUpdates.push({ externalId: id, labels });
      } else if (labels.length === 0 || isMailInScope(labels)) {
        // Gmail may leave out the labels of an added message: fetch and decide then.
        toFetch.push(id);
      }
    }
    for (const [id, change] of changes.labelChanges) {
      const current = stored.get(id);
      if (current === undefined) {
        // Not stored yet, but now in Doručené or Odeslané (moved out of spam, unarchived).
        if (change.add.has("INBOX") || change.add.has("SENT")) toFetch.push(id);
        continue;
      }
      const labels = applyLabelChange(current, change);
      if (isDiscardedMail(labels)) discarded.push(id);
      else if (labels.join() !== current.join()) labelUpdates.push({ externalId: id, labels });
    }

    result.deleted += await deleteMailMessages(db, scope, discarded);
    result.labelsChanged += await setMailLabels(db, scope, labelUpdates);
    try {
      for (const id of new Set(toFetch)) {
        await fetchAndQueue(id);
      }
    } finally {
      await flush();
    }
    await setSyncCursor(db, scope.organizationId, scope.connectionId, CURSOR_RESOURCE, latest);
  }

  if (cursor === null || input.mode === "full") {
    await full();
  } else {
    try {
      await incremental(cursor);
    } catch (error) {
      if (!(error instanceof MailHistoryExpiredError)) throw error;
      result.mode = "full";
      result.historyExpired = true;
      pending.length = 0;
      await full();
    }
  }

  result.expired = await deleteMailReceivedBefore(db, scope, windowStart);
  await refreshMailThreads(db, scope);
  return result;
}

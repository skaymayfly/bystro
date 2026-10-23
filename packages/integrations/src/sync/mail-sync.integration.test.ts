import { randomBytes } from "node:crypto";

import { Secret, type MailHistoryRecord, type MailLabel, type MailMessage } from "@bystro/core";
import {
  createDb,
  getSyncCursor,
  listMailMessages,
  listMailThreads,
  saveConnection,
  type SyncScope,
} from "@bystro/db";
import { createTestOrganization, readTestDatabase } from "@bystro/db/testing";
import { afterAll, describe, expect, it } from "vitest";

import { MailHistoryExpiredError, type MailboxReader } from "../gmail/mailbox";
import { syncMail } from "./mail-sync";

const { db, close } = createDb(readTestDatabase().url);
const key = randomBytes(32);

afterAll(async () => {
  await close();
});

const NOW = new Date("2026-10-24T08:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

/** A mailbox held in memory that records its changes the way Gmail's history does. */
class InMemoryMailbox implements MailboxReader {
  readonly source = "gmail";
  private historyId = 100;
  private history: { id: number; record: MailHistoryRecord }[] = [];
  readonly messages = new Map<string, MailMessage>();
  /** History older than this id is gone (Gmail answers 404). */
  expiredBefore = 0;
  /** `getMessage` fails on this call number, to simulate an interrupted run. */
  failOnGet: number | null = null;
  readonly calls = { list: 0, get: 0, history: 0 };
  /** Ids in the order they were fetched. */
  readonly fetched: string[] = [];

  private record(record: Partial<MailHistoryRecord>) {
    this.historyId += 1;
    this.history.push({
      id: this.historyId,
      record: { added: [], deleted: [], labelsAdded: [], labelsRemoved: [], ...record },
    });
  }

  add(id: string, overrides: Partial<MailMessage> = {}) {
    const message = mail(id, overrides);
    this.messages.set(id, message);
    this.record({ added: [{ id, labels: message.labels }] });
  }

  relabel(id: string, add: MailLabel[], remove: MailLabel[]) {
    const message = this.messages.get(id) as MailMessage;
    message.labels = [...message.labels.filter((label) => !remove.includes(label)), ...add];
    if (add.length > 0) this.record({ labelsAdded: [{ id, labels: add }] });
    if (remove.length > 0) this.record({ labelsRemoved: [{ id, labels: remove }] });
  }

  remove(id: string) {
    this.messages.delete(id);
    this.record({ deleted: [id] });
  }

  async currentHistoryId() {
    return String(this.historyId);
  }

  async listMessageIds(label: MailLabel, days: number, pageToken: string | null) {
    this.calls.list += 1;
    const ids = [...this.messages.values()]
      .filter((message) => message.labels.includes(label) && message.receivedAt >= daysAgo(days))
      .map((message) => message.externalId);
    const start = pageToken === null ? 0 : Number(pageToken);
    const end = start + 2;
    return { ids: ids.slice(start, end), nextPageToken: end < ids.length ? String(end) : null };
  }

  async getMessage(id: string) {
    this.calls.get += 1;
    if (this.failOnGet === this.calls.get) throw new Error("connection reset");
    this.fetched.push(id);
    const message = this.messages.get(id);
    return message === undefined ? null : { ...message, labels: [...message.labels] };
  }

  async listChanges(startHistoryId: string, pageToken: string | null) {
    this.calls.history += 1;
    if (Number(startHistoryId) < this.expiredBefore) throw new MailHistoryExpiredError("gone");
    const newer = this.history.filter((entry) => entry.id > Number(startHistoryId));
    const start = pageToken === null ? 0 : Number(pageToken);
    const end = start + 2;
    return {
      records: newer.slice(start, end).map((entry) => entry.record),
      nextPageToken: end < newer.length ? String(end) : null,
      historyId: String(this.historyId),
    };
  }
}

const mail = (id: string, overrides: Partial<MailMessage> = {}): MailMessage => ({
  source: "gmail",
  externalId: id,
  threadExternalId: `t-${id}`,
  historyId: null,
  receivedAt: daysAgo(2),
  labels: ["INBOX", "UNREAD"],
  from: { name: "Jana Nová", address: "jana@example.test" },
  to: [{ name: null, address: "petr@dvorak.test" }],
  cc: [],
  subject: `Zpráva ${id}`,
  messageIdHeader: `<${id}@example.test>`,
  inReplyTo: null,
  references: [],
  snippet: `Úryvek ${id}`,
  bodyText: `Text ${id}`,
  hasAttachments: false,
  ...overrides,
});

async function mailbox(name: string): Promise<SyncScope> {
  const { organization, owner } = await createTestOrganization(db, name);
  const connection = await saveConnection(
    db,
    organization.id,
    {
      provider: "gmail",
      category: "email",
      scopes: [],
      tokens: { accessToken: new Secret("token"), refreshToken: null, expiresAt: null },
      userId: owner.id,
      source: "web",
    },
    randomBytes(32),
  );
  return { organizationId: organization.id, connectionId: connection.id };
}

const stored = async (scope: SyncScope) =>
  Object.fromEntries(
    (await listMailMessages(db, scope, key)).map((message) => [message.externalId, message.labels]),
  );

const run = (scope: SyncScope, reader: MailboxReader, mode: "incremental" | "full", now = NOW) =>
  syncMail({ db, scope, reader, mode, encryptionKey: key, now });

describe("syncMail", () => {
  it("first syncs Doručené and Odeslané of 30 days, then repeating it duplicates nothing", async () => {
    const scope = await mailbox("Synchronizace pošty");
    const reader = new InMemoryMailbox();
    reader.add("in1");
    reader.add("in2", { threadExternalId: "t-in1", labels: ["INBOX"] });
    reader.add("sent1", { labels: ["SENT"] });
    reader.add("draft", { labels: ["DRAFT"] });
    reader.add("spam", { labels: ["SPAM", "UNREAD"] });
    reader.add("archived", { labels: [] });
    reader.add("old", { receivedAt: daysAgo(45) });

    const first = await run(scope, reader, "incremental");
    expect(first).toMatchObject({ mode: "full", created: 3, deleted: 0 });
    expect(await stored(scope)).toEqual({
      in1: ["INBOX", "UNREAD"],
      in2: ["INBOX"],
      sent1: ["SENT"],
    });
    expect(await getSyncCursor(db, scope.organizationId, scope.connectionId, "mail")).toBe("107");
    const threads = await listMailThreads(db, scope);
    expect(threads.find((thread) => thread.externalId === "t-in1")).toMatchObject({
      messageCount: 2,
      unread: true,
    });

    const gets = reader.calls.get;
    expect(await run(scope, reader, "incremental")).toMatchObject({
      mode: "incremental",
      created: 0,
      updated: 0,
      labelsChanged: 0,
      deleted: 0,
    });
    expect(await run(scope, reader, "full")).toMatchObject({ mode: "full", created: 0 });
    // Nothing already stored is downloaded again.
    expect(reader.calls.get).toBe(gets);
    expect(Object.keys(await stored(scope))).toHaveLength(3);
  });

  it("picks up new mail, mail read or archived elsewhere, trashed and deleted mail", async () => {
    const scope = await mailbox("Změny pošty");
    const reader = new InMemoryMailbox();
    reader.add("a");
    reader.add("b");
    reader.add("c");
    reader.add("d");
    await run(scope, reader, "incremental");

    reader.add("new", { labels: ["INBOX", "UNREAD"] });
    reader.relabel("a", [], ["UNREAD"]);
    reader.relabel("b", [], ["INBOX"]);
    reader.relabel("c", ["TRASH"], ["INBOX"]);
    reader.remove("d");
    reader.add("draft", { labels: ["DRAFT"] });

    const result = await run(scope, reader, "incremental");
    expect(result).toMatchObject({ mode: "incremental", created: 1, deleted: 2 });
    expect(await stored(scope)).toEqual({
      a: ["INBOX"],
      b: ["UNREAD"],
      new: ["INBOX", "UNREAD"],
    });
    const threads = await listMailThreads(db, scope);
    expect(threads.find((thread) => thread.externalId === "t-b")?.inInbox).toBe(false);
    expect(threads.map((thread) => thread.externalId)).not.toContain("t-c");
  });

  it("syncs everything again when the history is too old", async () => {
    const scope = await mailbox("Prošlá historie");
    const reader = new InMemoryMailbox();
    reader.add("a");
    await run(scope, reader, "incremental");

    reader.add("b");
    reader.relabel("a", [], ["INBOX", "UNREAD"]);
    reader.expiredBefore = 10_000;

    const result = await run(scope, reader, "incremental");
    expect(result).toMatchObject({ mode: "full", historyExpired: true, created: 1 });
    expect(await stored(scope)).toEqual({ a: [], b: ["INBOX", "UNREAD"] });
  });

  it("deletes mail that left the 30-day window", async () => {
    const scope = await mailbox("Okno pošty");
    const reader = new InMemoryMailbox();
    reader.add("recent", { receivedAt: daysAgo(1) });
    reader.add("ageing", { receivedAt: daysAgo(29) });
    await run(scope, reader, "incremental");
    expect(Object.keys(await stored(scope)).sort()).toEqual(["ageing", "recent"]);

    const later = new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000);
    const result = await run(scope, reader, "incremental", later);
    expect(result.expired).toBe(1);
    expect(Object.keys(await stored(scope))).toEqual(["recent"]);
  });

  it("keeps what it fetched when a run stops halfway, and the next run goes on", async () => {
    const scope = await mailbox("Přerušená synchronizace");
    const reader = new InMemoryMailbox();
    for (const id of ["m1", "m2", "m3", "m4"]) reader.add(id);
    reader.failOnGet = 3;

    await expect(run(scope, reader, "incremental")).rejects.toThrow("connection reset");
    // Newest first: the two that made it are the latest ones.
    expect(Object.keys(await stored(scope)).sort()).toEqual(["m3", "m4"]);
    // No marker yet: the next run is a full one again.
    expect(await getSyncCursor(db, scope.organizationId, scope.connectionId, "mail")).toBeNull();

    reader.failOnGet = null;
    const gets = reader.calls.get;
    expect(await run(scope, reader, "incremental")).toMatchObject({ mode: "full", created: 2 });
    expect(reader.calls.get - gets).toBe(2);
  });

  it("fills Pošta batch by batch, newest first, and reports progress as it goes", async () => {
    const scope = await mailbox("Postupné načítání");
    const reader = new InMemoryMailbox();
    // Gmail-like ids: hexadecimal numbers that grow over time.
    const ids = Array.from({ length: 45 }, (_, index) =>
      (0x18f2a1b3c4d5e600n + BigInt(index)).toString(16),
    );
    for (const id of ids) reader.add(id);

    const progress: { stored: number; threads: number }[] = [];
    await syncMail({
      db,
      scope,
      reader,
      mode: "full",
      encryptionKey: key,
      now: NOW,
      onProgress: async (count) => {
        progress.push({ stored: count, threads: (await listMailThreads(db, scope)).length });
      },
    });

    expect(reader.fetched).toEqual([...ids].reverse());
    // Batches of 20: the threads were already listed while the run was still going.
    expect(progress).toEqual([
      { stored: 20, threads: 20 },
      { stored: 40, threads: 40 },
      { stored: 45, threads: 45 },
    ]);
  });
});

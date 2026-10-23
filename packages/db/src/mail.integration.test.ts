import { randomBytes } from "node:crypto";

import { Secret, type MailMessage } from "@bystro/core";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { createDb } from "./client";
import { disconnectConnection, saveConnection } from "./integrations";
import type { SyncScope } from "./invoices";
import {
  archiveMailThread,
  countUnreadInboxThreads,
  deleteMailMessages,
  deleteMailReceivedBefore,
  getMailThread,
  listMailFolder,
  listMailMessages,
  listMailThreads,
  listStoredMailLabels,
  refreshMailThreads,
  setMailLabels,
  upsertMailMessages,
} from "./mail";
import { mailMessages } from "./schema";
import { createTestOrganization } from "./test/fixtures";
import { readTestDatabase } from "./test/test-database";

const { db, close } = createDb(readTestDatabase().url);
const key = randomBytes(32);

afterAll(async () => {
  await close();
});

async function mailbox(name: string): Promise<SyncScope & { userId: string }> {
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
  return { organizationId: organization.id, connectionId: connection.id, userId: owner.id };
}

const message = (externalId: string, overrides: Partial<MailMessage> = {}): MailMessage => ({
  source: "gmail",
  externalId,
  threadExternalId: "t1",
  historyId: "100",
  receivedAt: new Date("2026-10-20T08:00:00Z"),
  labels: ["INBOX", "UNREAD"],
  from: { name: "Jana Nová", address: "jana@example.test" },
  to: [{ name: null, address: "petr@dvorak.test" }],
  cc: [],
  subject: "Faktura 2026-0142",
  messageIdHeader: `<${externalId}@example.test>`,
  inReplyTo: null,
  references: [],
  snippet: "Dobrý den, posílám",
  bodyText: "Dobrý den,\nposílám fakturu.",
  hasAttachments: false,
  ...overrides,
});

describe("mail storage", () => {
  it("stores a message once, however often it is synced, and encrypts body and preview", async () => {
    const scope = await mailbox("Pošta jednou");
    expect(await upsertMailMessages(db, scope, [message("m1")], key)).toEqual({
      created: 1,
      updated: 0,
      unchanged: 0,
    });
    expect(await upsertMailMessages(db, scope, [message("m1")], key)).toEqual({
      created: 0,
      updated: 0,
      unchanged: 1,
    });

    const [row] = await db
      .select()
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.organizationId, scope.organizationId),
          eq(mailMessages.externalId, "m1"),
        ),
      );
    expect(row?.bodyEncrypted).not.toContain("fakturu");
    expect(row?.snippetEncrypted).not.toContain("posílám");
    expect(row?.subject).toBe("Faktura 2026-0142");

    const [stored] = await listMailMessages(db, scope, key);
    expect(stored?.bodyText).toBe("Dobrý den,\nposílám fakturu.");
    expect(stored?.snippet).toBe("Dobrý den, posílám");
  });

  it("updates a changed message and its labels", async () => {
    const scope = await mailbox("Pošta změny");
    await upsertMailMessages(db, scope, [message("m1")], key);
    expect(
      await upsertMailMessages(db, scope, [message("m1", { labels: ["INBOX"] })], key),
    ).toMatchObject({ updated: 1 });
    expect(await setMailLabels(db, scope, [{ externalId: "m1", labels: ["Label_7"] }])).toBe(1);
    expect(await setMailLabels(db, scope, [{ externalId: "missing", labels: [] }])).toBe(0);
    expect((await listStoredMailLabels(db, scope)).get("m1")).toEqual([]);
  });

  it("summarises threads and forgets threads without messages", async () => {
    const scope = await mailbox("Pošta vlákna");
    await upsertMailMessages(
      db,
      scope,
      [
        message("m1", { receivedAt: new Date("2026-10-20T08:00:00Z"), labels: ["INBOX"] }),
        message("m2", {
          receivedAt: new Date("2026-10-21T09:00:00Z"),
          labels: ["SENT"],
          subject: "Re: Faktura 2026-0142",
        }),
        message("m3", { threadExternalId: "t2", labels: ["INBOX", "UNREAD"] }),
      ],
      key,
    );
    await refreshMailThreads(db, scope);
    const threads = await listMailThreads(db, scope);
    expect(threads.map((thread) => thread.externalId)).toEqual(["t1", "t2"]);
    expect(threads[0]).toMatchObject({
      subject: "Faktura 2026-0142",
      messageCount: 2,
      unread: false,
      inInbox: true,
      hasSent: true,
      lastMessageAt: new Date("2026-10-21T09:00:00Z"),
    });
    expect(threads[1]).toMatchObject({ unread: true, messageCount: 1 });

    await deleteMailMessages(db, scope, ["m3"]);
    await refreshMailThreads(db, scope);
    expect((await listMailThreads(db, scope)).map((thread) => thread.externalId)).toEqual(["t1"]);
  });

  it("deletes mail older than the window", async () => {
    const scope = await mailbox("Pošta okno");
    await upsertMailMessages(
      db,
      scope,
      [
        message("old", { receivedAt: new Date("2026-09-01T00:00:00Z") }),
        message("new", { receivedAt: new Date("2026-10-20T00:00:00Z") }),
      ],
      key,
    );
    expect(await deleteMailReceivedBefore(db, scope, new Date("2026-09-24T00:00:00Z"))).toBe(1);
    expect([...(await listStoredMailLabels(db, scope)).keys()]).toEqual(["new"]);
  });

  it("deletes all mail of a mailbox when it is disconnected", async () => {
    const scope = await mailbox("Pošta odpojení");
    await upsertMailMessages(db, scope, [message("m1")], key);
    await refreshMailThreads(db, scope);
    await disconnectConnection(db, scope.organizationId, scope.connectionId, {
      userId: scope.userId,
      source: "web",
    });
    expect((await listStoredMailLabels(db, scope)).size).toBe(0);
    expect(await listMailThreads(db, scope)).toEqual([]);
  });

  it("keeps the mail of two organizations apart", async () => {
    const first = await mailbox("Pošta A");
    const second = await mailbox("Pošta B");
    await upsertMailMessages(db, first, [message("same-id")], key);
    await upsertMailMessages(db, second, [message("same-id", { subject: "Jiná firma" })], key);

    expect((await listStoredMailLabels(db, first)).size).toBe(1);
    // Deleting through one organization's scope cannot touch the other's mail.
    expect(await deleteMailMessages(db, first, ["same-id"])).toBe(1);
    const [left] = await listMailMessages(db, second, key);
    expect(left?.subject).toBe("Jiná firma");
    // A connection id of another organization finds nothing.
    expect(
      (await listStoredMailLabels(db, { ...first, connectionId: second.connectionId })).size,
    ).toBe(0);
  });
});

describe("mail for the Pošta screen", () => {
  async function filled(name: string) {
    const scope = await mailbox(name);
    await upsertMailMessages(
      db,
      scope,
      [
        message("in1", {
          threadExternalId: "t-faktura",
          receivedAt: new Date("2026-10-20T08:00:00Z"),
          labels: ["INBOX", "UNREAD"],
          subject: "Faktura 2026-0142",
          hasAttachments: true,
        }),
        message("re1", {
          threadExternalId: "t-faktura",
          receivedAt: new Date("2026-10-21T08:00:00Z"),
          labels: ["SENT"],
          from: { name: "Petr Dvořák", address: "petr@dvorak.test" },
          to: [{ name: "Jana Nová", address: "jana@example.test" }],
          subject: "Re: Faktura 2026-0142",
          snippet: "Děkuji, zaplatím",
          bodyText: "Děkuji, zaplatím do pátku.",
        }),
        message("in2", {
          threadExternalId: "t-schuzka",
          receivedAt: new Date("2026-10-22T08:00:00Z"),
          labels: ["INBOX"],
          from: { name: "Lenka Horáková", address: "lenka@horakova.test" },
          subject: "Schůzka 100% potvrzena",
          snippet: "Vidíme se ve čtvrtek",
        }),
      ],
      key,
    );
    await refreshMailThreads(db, scope);
    return scope;
  }

  it("lists Doručené and Odeslané with the counterpart and the last preview", async () => {
    const scope = await filled("Pošta složky");
    const inbox = await listMailFolder(db, scope, { folder: "inbox" }, key);
    expect(inbox.map((thread) => thread.externalId)).toEqual(["t-schuzka", "t-faktura"]);
    expect(inbox[1]).toMatchObject({
      subject: "Faktura 2026-0142",
      messageCount: 2,
      unread: true,
      hasAttachments: true,
      // The thread is with Jana; the last message (previewed) is the user's own reply.
      counterpart: { name: "Jana Nová", address: "jana@example.test" },
      snippet: "Děkuji, zaplatím",
    });

    const sent = await listMailFolder(db, scope, { folder: "sent" }, key);
    expect(sent.map((thread) => thread.externalId)).toEqual(["t-faktura"]);
    expect(sent[0]?.counterpart).toEqual({ name: "Jana Nová", address: "jana@example.test" });
    expect(await countUnreadInboxThreads(db, scope)).toBe(1);
  });

  it("searches subject, names and addresses, and takes % literally", async () => {
    const scope = await filled("Pošta hledání");
    const ids = async (query: string) =>
      (await listMailFolder(db, scope, { folder: "inbox", query }, key)).map(
        (thread) => thread.externalId,
      );
    expect(await ids("faktura")).toEqual(["t-faktura"]);
    expect(await ids("horakova.test")).toEqual(["t-schuzka"]);
    expect(await ids("Jana")).toEqual(["t-faktura"]);
    expect(await ids("100%")).toEqual(["t-schuzka"]);
    expect(await ids("%")).toEqual(["t-schuzka"]);
    // The body is encrypted: a word only in the body is not found.
    expect(await ids("pátku")).toEqual([]);
  });

  it("opens a thread oldest first with decrypted text, and archives it locally", async () => {
    const scope = await filled("Pošta detail");
    const thread = await getMailThread(db, scope, "t-faktura", key);
    expect(thread).toMatchObject({ subject: "Faktura 2026-0142", inInbox: true });
    expect(thread?.messages.map((item) => item.externalId)).toEqual(["in1", "re1"]);
    expect(thread?.messages[1]?.bodyText).toBe("Děkuji, zaplatím do pátku.");
    expect(await getMailThread(db, scope, "unknown", key)).toBeNull();

    expect(await archiveMailThread(db, scope, "t-faktura")).toBe(2);
    expect(
      (await listMailFolder(db, scope, { folder: "inbox" }, key)).map((item) => item.externalId),
    ).toEqual(["t-schuzka"]);
    expect((await getMailThread(db, scope, "t-faktura", key))?.inInbox).toBe(false);
    expect((await listStoredMailLabels(db, scope)).get("in1")).toEqual(["UNREAD"]);
  });

  it("shows nothing of another organization", async () => {
    const first = await filled("Pošta čtení A");
    const second = await mailbox("Pošta čtení B");
    expect(await listMailFolder(db, second, { folder: "inbox" }, key)).toEqual([]);
    expect(await getMailThread(db, second, "t-faktura", key)).toBeNull();
    expect(await archiveMailThread(db, second, "t-faktura")).toBe(0);
    expect(await listMailFolder(db, first, { folder: "inbox" }, key)).toHaveLength(2);
  });
});

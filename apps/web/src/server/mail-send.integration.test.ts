import { randomBytes, randomUUID } from "node:crypto";

import { Secret, type MailMessage } from "@bystro/core";
import {
  createDb,
  forOrganization,
  listActions,
  refreshMailThreads,
  saveConnection,
  upsertMailMessages,
} from "@bystro/db";
import { createTestOrganization, readTestDatabase } from "@bystro/db/testing";
import { afterAll, describe, expect, it } from "vitest";

import { mailSendStatus, sendMail, type SendMailRequest } from "./mail-send";

const { db, close } = createDb(readTestDatabase().url);
const key = randomBytes(32);

afterAll(async () => {
  await close();
});

const received: MailMessage = {
  source: "gmail",
  externalId: "m1",
  threadExternalId: "thread-1",
  historyId: null,
  receivedAt: new Date("2026-10-25T08:00:00Z"),
  labels: ["INBOX"],
  from: { name: "Jana Nová", address: "jana@novak.test" },
  to: [{ name: null, address: "petr@dvorak.test" }],
  cc: [],
  subject: "Faktura",
  messageIdHeader: "<jana-1@novak.test>",
  inReplyTo: null,
  references: ["<jana-0@novak.test>"],
  snippet: "",
  bodyText: "",
  hasAttachments: false,
};

async function companyWithMailbox() {
  const { organization, owner } = await createTestOrganization(db, "Firma odesílá");
  const connection = await saveConnection(
    db,
    organization.id,
    {
      provider: "gmail",
      category: "email",
      externalAccountId: "petr@dvorak.test",
      scopes: [],
      tokens: { accessToken: new Secret("t"), refreshToken: null, expiresAt: null },
      userId: owner.id,
      source: "web",
    },
    key,
  );
  const scope = { organizationId: organization.id, connectionId: connection.id };
  await upsertMailMessages(db, scope, [received], key);
  await refreshMailThreads(db, scope);
  return { organizationId: organization.id, userId: owner.id };
}

const request = (overrides: Partial<SendMailRequest> = {}): SendMailRequest => ({
  clientKey: randomUUID(),
  threadId: "thread-1",
  to: [{ name: "Jana Nová", address: "jana@novak.test" }],
  cc: [],
  subject: "Re: Faktura",
  body: "Tajná odpověď: zaplatím v pátek.",
  ...overrides,
});

function recorder() {
  const jobs: string[] = [];
  return {
    jobs,
    enqueue: async (_data: unknown, jobId: string) => {
      jobs.push(jobId);
      return true;
    },
  };
}

describe("sendMail", () => {
  it("proposes and approves one action per composer, however often Odeslat is clicked", async () => {
    const who = { ...(await companyWithMailbox()), role: "owner" as const };
    const queue = recorder();
    const deps = { db, encryptionKey: key, enqueue: queue.enqueue };
    const once = request();

    const first = await sendMail(deps, who, once);
    const second = await sendMail(deps, who, once);

    expect(first).toMatchObject({ ok: true, status: "approved" });
    expect(second).toMatchObject({ ok: true, actionId: first.ok ? first.actionId : "" });
    const all = await listActions(db, who.organizationId);
    expect(all.filter((action) => action.type === "mail_send")).toHaveLength(1);
    expect(new Set(queue.jobs).size).toBe(1);

    const [action] = all;
    expect(action?.preview).toMatchObject({
      to: [{ name: "Jana Nová", address: "jana@novak.test" }],
      subject: "Re: Faktura",
      threadExternalId: "thread-1",
      inReplyTo: "<jana-1@novak.test>",
      references: ["<jana-0@novak.test>"],
    });
    // The text is stored only encrypted, and the audit never holds it.
    expect(JSON.stringify(action?.preview)).not.toContain("zaplatím");
    const audit = await forOrganization(db, who.organizationId).listAuditLogs();
    expect(JSON.stringify(audit)).not.toMatch(/zaplatím|jana@novak/);

    expect(await mailSendStatus(db, who.organizationId, first.ok ? first.actionId : "")).toEqual({
      status: "approved",
      errorCode: null,
    });
  });

  it("sends a new message without a thread", async () => {
    const who = { ...(await companyWithMailbox()), role: "admin" as const };
    const result = await sendMail(
      { db, encryptionKey: key, enqueue: recorder().enqueue },
      who,
      request({ threadId: null, subject: "Nabídka" }),
    );
    expect(result).toMatchObject({ ok: true });
    const [action] = await listActions(db, who.organizationId);
    expect(action?.preview).toMatchObject({ threadExternalId: null, inReplyTo: null });
  });

  it("refuses members, invalid drafts, unknown threads and another company's mail", async () => {
    const who = await companyWithMailbox();
    const deps = { db, encryptionKey: key, enqueue: recorder().enqueue };
    expect(await sendMail(deps, { ...who, role: "member" }, request())).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await sendMail(deps, { ...who, role: "owner" }, request({ to: [] }))).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(
      await sendMail(deps, { ...who, role: "owner" }, request({ subject: "a\r\nBcc: x@y.test" })),
    ).toEqual({ ok: false, error: "invalid" });
    expect(await sendMail(deps, { ...who, role: "owner" }, request({ threadId: "neni" }))).toEqual({
      ok: false,
      error: "not_found",
    });

    const other = await createTestOrganization(db, "Bez schránky");
    expect(
      await sendMail(
        deps,
        { organizationId: other.organization.id, userId: other.owner.id, role: "owner" },
        request(),
      ),
    ).toEqual({ ok: false, error: "not_found" });
    expect(await mailSendStatus(db, other.organization.id, randomUUID())).toBeNull();
  });
});

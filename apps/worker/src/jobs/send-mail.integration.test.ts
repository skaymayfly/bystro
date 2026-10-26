import { randomBytes, randomUUID } from "node:crypto";

import { Secret, type MailSendPreview } from "@bystro/core";
import {
  applyActionEvent,
  createDb,
  decideAction,
  encrypt,
  getAction,
  proposeAction,
  saveConnection,
} from "@bystro/db";
import { createTestOrganization, loadRootEnv, readTestDatabase } from "@bystro/db/testing";
import { afterAll, describe, expect, it } from "vitest";

import { silentLogger } from "../test/redis";
import { executeActionHandler } from "./execute-action";
import { createMailSendExecutor, recoverActionsHandler, type MailSendDeps } from "./send-mail";

loadRootEnv();
const { db, close } = createDb(readTestDatabase().url);
const key = randomBytes(32);
const GMAIL = { clientId: "client-id", clientSecret: new Secret("client-secret") };
const system = { actor: { type: "system" as const }, source: "worker" as const };

afterAll(async () => {
  await close();
});

/** A reply the user approved by clicking Odeslat, from the mailbox petr@dvorak.test. */
async function approvedMail(preview: Partial<MailSendPreview> = {}) {
  const { organization, owner } = await createTestOrganization(db, "Firma s poštou");
  const connection = await saveConnection(
    db,
    organization.id,
    {
      provider: "gmail",
      category: "email",
      externalAccountId: "petr@dvorak.test",
      scopes: [],
      tokens: { accessToken: new Secret("access-token"), refreshToken: null, expiresAt: null },
      userId: owner.id,
      source: "web",
    },
    key,
  );
  const full: MailSendPreview = {
    to: [{ name: "Jana Nová", address: "jana@novak.test" }],
    cc: [],
    subject: "Re: Faktura 2026-0142",
    bodyEncrypted: encrypt("Děkuji, zaplatím do pátku.", key),
    threadExternalId: "thread-1",
    inReplyTo: "<jana-1@novak.test>",
    references: ["<jana-0@novak.test>"],
    ...preview,
  };
  const { action } = await proposeAction(db, organization.id, {
    type: "mail_send",
    triggerCode: "user_wrote",
    sources: [{ type: "integration_connection", id: connection.id }],
    preview: full as never,
    approvalLevel: "user",
    expiresAt: null,
    idempotencyKey: `mail_send:${randomUUID()}`,
    proposedBy: { type: "user", userId: owner.id },
    source: "web",
  });
  await decideAction(db, organization.id, action.id, {
    userId: owner.id,
    decision: "approved",
    source: "web",
  });
  return { organizationId: organization.id, actionId: action.id, connectionId: connection.id };
}

/** A stand-in for Gmail: which messages are in Odeslané, and what was sent. */
function fakeGmail(
  options: { alreadySent?: string; sendStatus?: number; listStatus?: number } = {},
) {
  const sent: { raw: string; threadId?: string }[] = [];
  const queries: string[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages") && (init?.method ?? "GET") === "GET") {
      queries.push(url.searchParams.get("q") ?? "");
      if (options.listStatus !== undefined)
        return new Response(null, { status: options.listStatus });
      return Response.json(
        options.alreadySent === undefined
          ? { resultSizeEstimate: 0 }
          : { messages: [{ id: options.alreadySent, threadId: "thread-1" }] },
      );
    }
    if (url.pathname.endsWith("/messages/send")) {
      if (options.sendStatus !== undefined)
        return new Response(null, { status: options.sendStatus });
      sent.push(JSON.parse(String(init?.body)) as { raw: string; threadId?: string });
      return Response.json({ id: `sent-${sent.length}`, threadId: "thread-1" });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { sent, queries, fetchFn };
}

const deps = (fetchFn: typeof fetch, overrides: Partial<MailSendDeps> = {}): MailSendDeps => ({
  db,
  encryptionKey: key,
  gmail: GMAIL,
  fetch: fetchFn,
  ...overrides,
});

const execute = (mailDeps: MailSendDeps, organizationId: string, actionId: string) =>
  executeActionHandler({
    db,
    executors: { mail_send: createMailSendExecutor(mailDeps) },
  })({ data: { organizationId, actionId }, jobId: "job-1", attempt: 1, logger: silentLogger });

const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");

describe("sending mail as an action", () => {
  it("sends the reply once, in its thread, and keeps Gmail's id as the result", async () => {
    const { organizationId, actionId } = await approvedMail();
    const gmail = fakeGmail();
    const syncs: string[] = [];

    await execute(
      deps(gmail.fetchFn, {
        enqueueMailSync: async (_data, jobId) => {
          syncs.push(jobId);
          return true;
        },
      }),
      organizationId,
      actionId,
    );

    expect(gmail.sent).toHaveLength(1);
    expect(gmail.sent[0]?.threadId).toBe("thread-1");
    const raw = decode(gmail.sent[0]?.raw ?? "");
    expect(raw).toContain(`Message-ID: <bystro.${actionId}@dvorak.test>`);
    expect(raw).toContain("In-Reply-To: <jana-1@novak.test>");
    expect(raw).toContain("References: <jana-0@novak.test> <jana-1@novak.test>");
    expect(raw).toContain("From: petr@dvorak.test");
    const body = raw.split("\r\n\r\n")[1]?.replace(/\r\n/g, "") ?? "";
    expect(Buffer.from(body, "base64").toString("utf8")).toBe("Děkuji, zaplatím do pátku.");
    expect(gmail.queries).toEqual([`rfc822msgid:bystro.${actionId}@dvorak.test`]);

    const action = await getAction(db, organizationId, actionId);
    expect(action).toMatchObject({ status: "succeeded", resultReference: "sent-1" });
    expect(syncs).toHaveLength(1);

    // The same job again (a retry, a duplicate): nothing is sent twice.
    await execute(deps(gmail.fetchFn), organizationId, actionId);
    expect(gmail.sent).toHaveLength(1);
  });

  it("does not send again what is already in Odeslané", async () => {
    const { organizationId, actionId } = await approvedMail();
    const gmail = fakeGmail({ alreadySent: "sent-earlier" });
    await execute(deps(gmail.fetchFn), organizationId, actionId);
    expect(gmail.sent).toEqual([]);
    expect(await getAction(db, organizationId, actionId)).toMatchObject({
      status: "succeeded",
      resultReference: "sent-earlier",
    });
  });

  it("fails with a code when Gmail refuses or is not configured", async () => {
    for (const [mailDeps, code] of [
      [deps(fakeGmail({ sendStatus: 401 }).fetchFn), "reauth_required"],
      [deps(fakeGmail({ sendStatus: 429 }).fetchFn), "rate_limited"],
      [deps(fakeGmail().fetchFn, { gmail: null }), "provider_not_configured"],
    ] as const) {
      const { organizationId, actionId } = await approvedMail();
      await execute(mailDeps, organizationId, actionId);
      expect(await getAction(db, organizationId, actionId)).toMatchObject({
        status: "failed",
        errorCode: code,
      });
    }
  });
});

describe("recoverActionsHandler", () => {
  async function stuckMail() {
    const created = await approvedMail();
    await applyActionEvent(db, created.organizationId, created.actionId, "start", {
      ...system,
      now: new Date(Date.now() - 30 * 60 * 1000),
    });
    return created;
  }
  const recover = (mailDeps: MailSendDeps) =>
    recoverActionsHandler(mailDeps)({ data: {}, jobId: "r", attempt: 1, logger: silentLogger });

  it("marks a stuck action sent when the message is in Odeslané, and never sends", async () => {
    const { organizationId, actionId } = await stuckMail();
    const gmail = fakeGmail({ alreadySent: "sent-before-crash" });
    await recover(deps(gmail.fetchFn));
    expect(await getAction(db, organizationId, actionId)).toMatchObject({
      status: "succeeded",
      resultReference: "sent-before-crash",
    });
    expect(gmail.sent).toEqual([]);
  });

  it("fails a stuck action as interrupted when nothing went out", async () => {
    const { organizationId, actionId } = await stuckMail();
    await recover(deps(fakeGmail().fetchFn));
    expect(await getAction(db, organizationId, actionId)).toMatchObject({
      status: "failed",
      errorCode: "interrupted",
    });
  });

  it("leaves it for the next run when Gmail cannot be asked", async () => {
    const { organizationId, actionId } = await stuckMail();
    await recover(deps(fakeGmail({ listStatus: 503 }).fetchFn));
    expect((await getAction(db, organizationId, actionId))?.status).toBe("executing");
  });

  it("leaves a recently started action alone", async () => {
    const { organizationId, actionId } = await approvedMail();
    await applyActionEvent(db, organizationId, actionId, "start", system);
    await recover(deps(fakeGmail({ alreadySent: "x" }).fetchFn));
    expect((await getAction(db, organizationId, actionId))?.status).toBe("executing");
  });
});

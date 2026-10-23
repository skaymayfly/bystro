import { randomBytes } from "node:crypto";

import { Secret, type MailMessage } from "@bystro/core";
import {
  createDb,
  forOrganization,
  getMailThread,
  refreshMailThreads,
  saveConnection,
  upsertMailMessages,
  type ConnectionTokens,
} from "@bystro/db";
import { createTestOrganization, readTestDatabase } from "@bystro/db/testing";
import { afterAll, describe, expect, it } from "vitest";

import { archiveThread, type MailDeps } from "./mail";

const { db, close } = createDb(readTestDatabase().url);
const key = randomBytes(32);
const GMAIL = { clientId: "client-id", clientSecret: new Secret("client-secret") };

afterAll(async () => {
  await close();
});

const message = (id: string, labels: MailMessage["labels"]): MailMessage => ({
  source: "gmail",
  externalId: id,
  threadExternalId: "thread-1",
  historyId: null,
  receivedAt: new Date("2026-10-22T08:00:00Z"),
  labels,
  from: { name: "Jana Nová", address: "jana@example.test" },
  to: [],
  cc: [],
  subject: "Tajná faktura",
  messageIdHeader: null,
  inReplyTo: null,
  references: [],
  snippet: "tajný úryvek",
  bodyText: "tajný text",
  hasAttachments: false,
});

async function mailboxWithThread(tokens: Partial<ConnectionTokens> = {}) {
  const { organization, owner } = await createTestOrganization(db, "Firma s poštou");
  const connection = await saveConnection(
    db,
    organization.id,
    {
      provider: "gmail",
      category: "email",
      externalAccountId: "petr@dvorak.test",
      scopes: [],
      tokens: {
        accessToken: new Secret("access-token"),
        refreshToken: new Secret("refresh-token"),
        expiresAt: null,
        ...tokens,
      },
      userId: owner.id,
      source: "web",
    },
    key,
  );
  const scope = { organizationId: organization.id, connectionId: connection.id };
  await upsertMailMessages(
    db,
    scope,
    [message("m1", ["INBOX", "UNREAD"]), message("m2", ["SENT"])],
    key,
  );
  await refreshMailThreads(db, scope);
  return { scope, who: { organizationId: organization.id, userId: owner.id } };
}

function fakeGmail(answer: (url: URL) => Response) {
  const requests: { url: string; method: string; body: string; authorization: string | null }[] =
    [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({
      url: url.toString(),
      method: init?.method ?? "GET",
      body: String(init?.body ?? ""),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return answer(url);
  }) as typeof fetch;
  return { requests, fetchFn };
}

const deps = (fetchFn: typeof fetch, overrides: Partial<MailDeps> = {}): MailDeps => ({
  db,
  encryptionKey: key,
  gmail: GMAIL,
  fetch: fetchFn,
  now: () => new Date("2026-10-24T08:00:00Z"),
  ...overrides,
});

describe("archiveThread", () => {
  it("archives in Gmail, then in Bystro, and audits without any content", async () => {
    const { scope, who } = await mailboxWithThread();
    const gmail = fakeGmail(() => Response.json({ id: "thread-1" }));

    expect(await archiveThread(deps(gmail.fetchFn), who, "thread-1")).toEqual({ ok: true });

    expect(gmail.requests).toEqual([
      {
        url: "https://gmail.googleapis.com/gmail/v1/users/me/threads/thread-1/modify",
        method: "POST",
        body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
        authorization: "Bearer access-token",
      },
    ]);
    const thread = await getMailThread(db, scope, "thread-1", key);
    expect(thread?.inInbox).toBe(false);
    expect(thread?.messages.map((item) => item.labels)).toEqual([["UNREAD"], ["SENT"]]);

    const audit = await forOrganization(db, who.organizationId).listAuditLogs();
    const archived = audit.find((entry) => entry.action === "mail.thread_archived");
    expect(archived).toMatchObject({
      actorType: "user",
      source: "web",
      targetType: "mail_thread",
      targetId: "thread-1",
      metadata: { provider: "gmail", messages: 2 },
    });
    expect(JSON.stringify(audit)).not.toMatch(/tajn|jana@example|access-token/);
  });

  it("refreshes an expired access token first", async () => {
    const { who } = await mailboxWithThread({ expiresAt: new Date("2026-10-24T07:00:00Z") });
    const gmail = fakeGmail((url) =>
      url.pathname === "/token"
        ? Response.json({ access_token: "access-new", token_type: "Bearer", expires_in: 3599 })
        : Response.json({ id: "thread-1" }),
    );
    expect(await archiveThread(deps(gmail.fetchFn), who, "thread-1")).toEqual({ ok: true });
    expect(gmail.requests.map((request) => request.url)).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://gmail.googleapis.com/gmail/v1/users/me/threads/thread-1/modify",
    ]);
    expect(gmail.requests[1]?.authorization).toBe("Bearer access-new");
  });

  it("changes nothing in Bystro when Gmail refuses", async () => {
    const { scope, who } = await mailboxWithThread();
    for (const [status, error] of [
      [401, "reauth_required"],
      [503, "provider_unavailable"],
    ] as const) {
      const gmail = fakeGmail(() => new Response(null, { status }));
      expect(await archiveThread(deps(gmail.fetchFn), who, "thread-1")).toEqual({
        ok: false,
        error,
      });
    }
    expect((await getMailThread(db, scope, "thread-1", key))?.inInbox).toBe(true);
  });

  it("finds no thread of another organization and asks nothing of Gmail", async () => {
    await mailboxWithThread();
    const { organization, owner } = await createTestOrganization(db, "Cizí firma");
    const gmail = fakeGmail(() => Response.json({}));
    expect(
      await archiveThread(
        deps(gmail.fetchFn),
        { organizationId: organization.id, userId: owner.id },
        "thread-1",
      ),
    ).toEqual({ ok: false, error: "not_found" });
    expect(gmail.requests).toEqual([]);
  });

  it("says so when Gmail is not configured here", async () => {
    const { who } = await mailboxWithThread();
    const gmail = fakeGmail(() => Response.json({}));
    expect(await archiveThread(deps(gmail.fetchFn, { gmail: null }), who, "thread-1")).toEqual({
      ok: false,
      error: "provider_unavailable",
    });
  });
});

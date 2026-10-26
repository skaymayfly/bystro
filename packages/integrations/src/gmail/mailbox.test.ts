import { ProviderError, Secret } from "@bystro/core";
import { describe, expect, it } from "vitest";

import historyExample from "./fixtures/history.json";
import fullMessage from "./fixtures/message-full.json";
import htmlMessage from "./fixtures/message-html.json";
import listExample from "./fixtures/messages-list.json";
import { GmailClient } from "./gmail";
import {
  archiveGmailThread,
  findSentGmailMessage,
  getGmailMessage,
  GMAIL_COST,
  GmailMailbox,
  listGmailHistory,
  listGmailMessages,
  MailHistoryExpiredError,
  sendGmailMessage,
} from "./mailbox";

type Route = { status: number; body?: unknown; headers?: Record<string, string> };

function client(route: (url: URL) => Route) {
  const urls: URL[] = [];
  const costs: number[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    urls.push(url);
    const answer = route(url);
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: answer.headers ?? {},
    });
  }) as typeof fetch;
  const gmail = new GmailClient({
    accessToken: new Secret("access-token"),
    fetch: fetchFn,
    onRequest: async (cost) => {
      costs.push(cost);
    },
  });
  return { gmail, urls, costs };
}

describe("listGmailMessages", () => {
  it("lists ids of one label in the window, 500 a page, and pays 5 units", async () => {
    const { gmail, urls, costs } = client(() => ({ status: 200, body: listExample }));
    const page = await listGmailMessages(gmail, {
      labelId: "INBOX",
      query: "newer_than:30d",
      pageToken: "page-1",
    });

    expect(page).toEqual({
      messages: [
        { id: "18f2a1b3c4d5e6f7", threadId: "18f2a1b3c4d5e6f7" },
        { id: "18f2a1b3c4d5e700", threadId: "18f2a1b3c4d5e6f7" },
      ],
      nextPageToken: "page-2",
    });
    const url = urls[0] as URL;
    expect(url.pathname).toBe("/gmail/v1/users/me/messages");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      labelIds: "INBOX",
      maxResults: "500",
      q: "newer_than:30d",
      pageToken: "page-1",
    });
    expect(costs).toEqual([GMAIL_COST.list]);
  });

  it("asks for trash and spam explicitly and treats an empty mailbox as no messages", async () => {
    const { gmail, urls } = client(() => ({ status: 200, body: { resultSizeEstimate: 0 } }));
    expect(await listGmailMessages(gmail, { labelId: "TRASH" })).toEqual({
      messages: [],
      nextPageToken: null,
    });
    expect(urls[0]?.searchParams.get("includeSpamTrash")).toBe("true");
  });
});

describe("getGmailMessage", () => {
  it("maps a whole message: labels, addresses, reply headers, plain text and attachment", async () => {
    const { gmail, urls, costs } = client(() => ({ status: 200, body: fullMessage }));
    const message = await getGmailMessage(gmail, "18f2a1b3c4d5e6f7");

    expect(urls[0]?.pathname).toBe("/gmail/v1/users/me/messages/18f2a1b3c4d5e6f7");
    expect(urls[0]?.searchParams.get("format")).toBe("full");
    expect(costs).toEqual([GMAIL_COST.getFull]);
    expect(message).toEqual({
      source: "gmail",
      externalId: "18f2a1b3c4d5e6f7",
      threadExternalId: "18f2a1b3c4d5e6f7",
      historyId: "482913",
      receivedAt: new Date(1792396800000),
      labels: ["INBOX", "UNREAD"],
      from: { name: "Jana Nová", address: "jana.nova@example.test" },
      to: [
        { name: "Petr Dvořák", address: "petr@dvorak-interiery.test" },
        { name: "Účetní, Eva", address: "eva@ucetni.test" },
      ],
      cc: [{ name: null, address: "info@dvorak-interiery.test" }],
      subject: "Faktura č. 2026-0142",
      messageIdHeader: "<CAF1x2y3@mail.example.test>",
      inReplyTo: "<prev@mail.example.test>",
      references: ["<first@mail.example.test>", "<prev@mail.example.test>"],
      snippet: "Dobrý den, posílám fakturu za kuchyňskou linku.",
      bodyText: "Dobrý den,\nposílám fakturu za kuchyňskou linku.\n\nJana",
      hasAttachments: true,
    });
  });

  it("reduces an HTML-only message in windows-1250 to text, without the script", async () => {
    const { gmail } = client(() => ({ status: 200, body: htmlMessage }));
    const message = await getGmailMessage(gmail, "18f2a1b3c4d5e700");
    expect(message).toMatchObject({
      labels: ["SENT"],
      from: { name: null, address: "petr@dvorak-interiery.test" },
      to: [{ name: "Jana Nová", address: "jana.nova@example.test" }],
      subject: "Re: Faktura č. 2026-0142",
      bodyText: "Děkuji, zaplatíme do pátku.",
      hasAttachments: false,
    });
  });

  it("returns null for a message that no longer exists", async () => {
    const { gmail } = client(() => ({ status: 404, body: { error: { code: 404 } } }));
    expect(await getGmailMessage(gmail, "gone")).toBeNull();
  });

  it("refuses a malformed message without echoing it", async () => {
    const { gmail } = client(() => ({ status: 200, body: { id: "x", snippet: "tajné" } }));
    const error = await getGmailMessage(gmail, "x").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).code).toBe("invalid_response");
    expect(String(error)).not.toContain("tajné");
  });
});

describe("listGmailHistory", () => {
  it("reads added, relabelled and deleted messages and the new marker, for 2 units", async () => {
    const { gmail, urls, costs } = client(() => ({ status: 200, body: historyExample }));
    const page = await listGmailHistory(gmail, "482913", null);

    expect(urls[0]?.searchParams.get("startHistoryId")).toBe("482913");
    expect(urls[0]?.searchParams.getAll("historyTypes")).toEqual([
      "messageAdded",
      "messageDeleted",
      "labelAdded",
      "labelRemoved",
    ]);
    expect(costs).toEqual([GMAIL_COST.history]);
    expect(page).toEqual({
      records: [
        {
          added: [{ id: "18f2a1b3c4d5e800", labels: ["INBOX", "UNREAD"] }],
          deleted: [],
          labelsAdded: [],
          labelsRemoved: [],
        },
        {
          added: [],
          deleted: [],
          labelsAdded: [],
          labelsRemoved: [{ id: "18f2a1b3c4d5e6f7", labels: ["INBOX"] }],
        },
        { added: [], deleted: ["18f2a1b3c4d5e555"], labelsAdded: [], labelsRemoved: [] },
      ],
      nextPageToken: null,
      historyId: "482999",
    });
  });

  it("reports an out-of-date history id as expired", async () => {
    const { gmail } = client(() => ({ status: 404, body: { error: { code: 404 } } }));
    await expect(listGmailHistory(gmail, "1", null)).rejects.toBeInstanceOf(
      MailHistoryExpiredError,
    );
  });

  it("maps auth, quota and outage errors to provider codes", async () => {
    for (const [status, code] of [
      [401, "reauth_required"],
      [403, "forbidden"],
      [429, "rate_limited"],
      [503, "provider_unavailable"],
    ] as const) {
      const { gmail } = client(() => ({ status, headers: { "retry-after": "7" } }));
      const error = await listGmailHistory(gmail, "1", null).catch((caught: unknown) => caught);
      expect((error as ProviderError).code).toBe(code);
    }
  });
});

describe("GmailMailbox", () => {
  it("lists a label within the window and reads the current marker from the profile", async () => {
    const { gmail, urls } = client((url) =>
      url.pathname.endsWith("/profile")
        ? { status: 200, body: { emailAddress: "petr@dvorak.test", historyId: "500" } }
        : { status: 200, body: listExample },
    );
    const mailbox = new GmailMailbox(gmail);
    expect(await mailbox.currentHistoryId()).toBe("500");
    expect(await mailbox.listMessageIds("SENT", 30, null)).toEqual({
      ids: ["18f2a1b3c4d5e6f7", "18f2a1b3c4d5e700"],
      nextPageToken: "page-2",
    });
    expect(urls[1]?.searchParams.get("q")).toBe("newer_than:30d");
    expect(urls[1]?.searchParams.get("labelIds")).toBe("SENT");
  });
});

describe("archiveGmailThread", () => {
  it("removes INBOX from the whole thread with one POST for 10 units", async () => {
    const requests: { url: URL; method: string; body: string }[] = [];
    const costs: number[] = [];
    const gmail = new GmailClient({
      accessToken: new Secret("access-token"),
      onRequest: async (cost) => {
        costs.push(cost);
      },
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: new URL(String(input)),
          method: init?.method ?? "GET",
          body: String(init?.body),
        });
        return Response.json({ id: "t1", historyId: "901" });
      }) as typeof fetch,
    });

    expect(await archiveGmailThread(gmail, "t1")).toBe(true);
    expect(requests).toEqual([
      {
        url: new URL("https://gmail.googleapis.com/gmail/v1/users/me/threads/t1/modify"),
        method: "POST",
        body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
      },
    ]);
    expect(costs).toEqual([GMAIL_COST.modifyThread]);
  });

  it("reports a thread that no longer exists and passes on other errors", async () => {
    const { gmail } = client(() => ({ status: 404 }));
    expect(await archiveGmailThread(gmail, "gone")).toBe(false);
    const denied = client(() => ({ status: 401 }));
    await expect(archiveGmailThread(denied.gmail, "t1")).rejects.toMatchObject({
      code: "reauth_required",
    });
  });
});

describe("Gmail's 403 reasons", () => {
  const refusal = (reason: string, field: "errors" | "details" = "errors") => ({
    status: 403,
    body: { error: { code: 403, message: "secret text", [field]: [{ reason }] } },
  });

  it("waits out per-minute and daily limits instead of giving up", async () => {
    for (const [answer, waitMs] of [
      [refusal("userRateLimitExceeded"), 60_000],
      [refusal("rateLimitExceeded"), 60_000],
      [refusal("RATE_LIMIT_EXCEEDED", "details"), 60_000],
      [refusal("dailyLimitExceeded"), 3_600_000],
    ] as const) {
      const { gmail } = client(() => answer);
      const error = (await listGmailHistory(gmail, "1", null).catch(
        (caught: unknown) => caught,
      )) as ProviderError;
      expect(error.code).toBe("rate_limited");
      expect(error.retryable).toBe(true);
      expect(error.retryAfterMs).toBe(waitMs);
    }
  });

  it("tells a switched-off API, a domain policy and a missing scope apart", async () => {
    for (const [answer, code] of [
      [refusal("accessNotConfigured"), "api_disabled"],
      [refusal("SERVICE_DISABLED", "details"), "api_disabled"],
      [refusal("domainPolicy"), "account_blocked"],
      [refusal("insufficientPermissions"), "reauth_required"],
      [refusal("somethingNew"), "forbidden"],
      [{ status: 403 }, "forbidden"],
    ] as const) {
      const { gmail } = client(() => answer);
      const error = (await listGmailHistory(gmail, "1", null).catch(
        (caught: unknown) => caught,
      )) as ProviderError;
      expect(error.code).toBe(code);
      expect(error.retryable).toBe(false);
      expect(String(error)).not.toContain("secret text");
    }
  });
});

describe("sending", () => {
  it("sends the raw message into its thread for 100 units and returns Gmail's ids", async () => {
    const requests: { url: URL; body: string }[] = [];
    const costs: number[] = [];
    const gmail = new GmailClient({
      accessToken: new Secret("access-token"),
      onRequest: async (cost) => {
        costs.push(cost);
      },
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: new URL(String(input)), body: String(init?.body) });
        return Response.json({ id: "sent-1", threadId: "t1", labelIds: ["SENT"] });
      }) as typeof fetch,
    });

    expect(await sendGmailMessage(gmail, "cmF3", "t1")).toEqual({ id: "sent-1", threadId: "t1" });
    expect(requests[0]?.url.pathname).toBe("/gmail/v1/users/me/messages/send");
    expect(JSON.parse(requests[0]?.body ?? "")).toEqual({ raw: "cmF3", threadId: "t1" });
    expect(costs).toEqual([GMAIL_COST.send]);

    await sendGmailMessage(gmail, "cmF3", null);
    expect(JSON.parse(requests[1]?.body ?? "")).toEqual({ raw: "cmF3" });
  });

  it("maps Gmail's sending limit and refuses a malformed answer", async () => {
    const limited = client(() => ({ status: 429, headers: { "retry-after": "3600" } }));
    await expect(sendGmailMessage(limited.gmail, "cmF3", null)).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterMs: 3_600_000,
    });
    const odd = client(() => ({ status: 200, body: { nothing: true } }));
    await expect(sendGmailMessage(odd.gmail, "cmF3", null)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("finds a sent message by its Message-ID in Odeslané", async () => {
    const { gmail, urls } = client(() => ({
      status: 200,
      body: { messages: [{ id: "sent-1", threadId: "t1" }] },
    }));
    expect(await findSentGmailMessage(gmail, "<bystro.a1@dvorak.test>")).toBe("sent-1");
    expect(urls[0]?.searchParams.get("q")).toBe("rfc822msgid:bystro.a1@dvorak.test");
    expect(urls[0]?.searchParams.get("labelIds")).toBe("SENT");

    const none = client(() => ({ status: 200, body: { resultSizeEstimate: 0 } }));
    expect(await findSentGmailMessage(none.gmail, "<x@y>")).toBeNull();
  });
});

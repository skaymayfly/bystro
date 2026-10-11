import { ProviderError, Secret } from "@bystro/core";
import { describe, expect, it } from "vitest";

import { FakturoidClient, fakturoidUserAgent, rateLimitWaitMs } from "./client";
import {
  fakturoidOAuthConfig,
  FakturoidProvider,
  listFakturoidAccounts,
  mapFakturoidInvoice,
  mapFakturoidPayments,
  mapFakturoidSubject,
} from "./fakturoid";
// Example responses copied from the Fakturoid API v3 documentation on 2026-10-11
// (invoices index, subjects index, current user, invoice payment). Variants used below are
// derived from them field by field.
import invoiceExample from "./fixtures/invoice.json";
import paymentExample from "./fixtures/payment.json";
import subjectExample from "./fixtures/subject.json";
import userExample from "./fixtures/user.json";

const TOKEN = "access-token-plaintext";
const USER_AGENT = fakturoidUserAgent("vyvoj@bystro.example");

type Route = { status: number; body?: unknown; headers?: Record<string, string> };

/** A fake `fetch` answering by path; records every request. */
function fakeFetch(routes: (url: URL) => Route | Route[]) {
  const calls: { url: URL; headers: Headers }[] = [];
  const queues = new Map<string, Route[]>();
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    const key = url.pathname + url.search;
    let answer = routes(url);
    if (Array.isArray(answer)) {
      const queue = queues.get(key) ?? [...answer];
      queues.set(key, queue);
      answer = queue.length > 1 ? (queue.shift() as Route) : (queue[0] as Route);
    }
    const body =
      answer.body === undefined
        ? null
        : answer.body instanceof Uint8Array
          ? answer.body
          : JSON.stringify(answer.body);
    return new Response(body, { status: answer.status, headers: answer.headers ?? {} });
  }) as typeof fetch;
  return { calls, fetchFn };
}

function provider(routes: Parameters<typeof fakeFetch>[0]) {
  const fake = fakeFetch(routes);
  const client = new FakturoidClient({
    accessToken: new Secret(TOKEN),
    userAgent: USER_AGENT,
    fetch: fake.fetchFn,
    sleep: async () => {},
  });
  return { ...fake, client, provider: new FakturoidProvider(client, "applecorp") };
}

const invoice = (overrides: Record<string, unknown> = {}) => ({ ...invoiceExample, ...overrides });

async function providerError(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    return error as ProviderError;
  }
  throw new Error("expected a ProviderError");
}

describe("mapFakturoidInvoice", () => {
  it("maps the documented example invoice exactly", () => {
    expect(mapFakturoidInvoice(invoiceExample)).toEqual({
      source: "fakturoid",
      externalId: "27",
      sourceUpdatedAt: new Date("2023-12-01T09:05:47.187+01:00"),
      number: "2023-0021",
      variableSymbol: "20230021",
      kind: "invoice",
      direction: "issued",
      sourceStatus: "open",
      clientExternalId: "16",
      issuedOn: "2023-11-30",
      taxableSupplyOn: "2023-11-30",
      dueOn: "2023-12-14",
      paidOn: null,
      currency: "CZK",
      subtotalMinor: 913_360n,
      vatMinor: 186_640n,
      totalMinor: 1_100_000n,
      lines: [
        {
          externalId: "46",
          position: 1,
          description: "Grafická karta",
          quantityMilli: 1_000,
          unit: null,
          unitPriceMinor: 826_400n,
          vatRateBasisPoints: 2_100,
          totalMinor: 1_000_000n,
        },
        {
          externalId: "47",
          position: 2,
          description: "Jídlo",
          quantityMilli: 5_000,
          unit: null,
          unitPriceMinor: 17_392n,
          vatRateBasisPoints: 1_500,
          totalMinor: 100_000n,
        },
      ],
    });
  });

  it("maps every documented status", () => {
    const status = (value: string) => mapFakturoidInvoice(invoice({ status: value }))?.sourceStatus;
    expect(["open", "sent", "overdue"].map(status)).toEqual(["open", "open", "open"]);
    expect(status("paid")).toBe("paid");
    expect(status("cancelled")).toBe("cancelled");
    // Nedobytná: no income expected, nobody to remind.
    expect(status("uncollectible")).toBe("cancelled");
  });

  it("maps every documented document type and skips tax documents", () => {
    const kind = (value: string) => mapFakturoidInvoice(invoice({ document_type: value }))?.kind;
    expect(kind("invoice")).toBe("invoice");
    expect(kind("final_invoice")).toBe("invoice");
    expect(kind("proforma")).toBe("proforma");
    expect(kind("partial_proforma")).toBe("proforma");
    expect(kind("correction")).toBe("credit_note");
    expect(mapFakturoidInvoice(invoice({ document_type: "tax_document" }))).toBeNull();
  });

  it("keeps a negative credit note and a foreign currency as they are", () => {
    const correction = mapFakturoidInvoice(
      invoice({
        document_type: "correction",
        subtotal: "-826.4",
        total: "-1000.0",
        currency: "eur",
      }),
    );
    expect(correction).toMatchObject({
      kind: "credit_note",
      subtotalMinor: -82_640n,
      vatMinor: -17_360n,
      totalMinor: -100_000n,
      currency: "EUR",
    });
  });

  it("drops values our model cannot hold instead of guessing", () => {
    const mapped = mapFakturoidInvoice(
      invoice({ variable_symbol: "VS-2023/21", taxable_fulfillment_due: null }),
    );
    expect(mapped).toMatchObject({ variableSymbol: null, taxableSupplyOn: null });
    const noLineId = mapFakturoidInvoice(
      invoice({ lines: [{ ...invoiceExample.lines[0], id: null }] }),
    );
    expect(noLineId?.lines[0]?.externalId).toBe("27#1");
  });

  it("refuses what does not match the documentation", () => {
    const invalid = [
      invoice({ status: "draft" }),
      invoice({ document_type: "estimate" }),
      invoice({ total: 11000 }),
      invoice({ total: "11000.005" }),
      invoice({ due_on: "14.12.2023" }),
      invoice({ taxable_fulfillment_due: "listopad" }),
      invoice({ id: undefined }),
      "not an invoice",
    ];
    for (const raw of invalid) {
      expect(() => mapFakturoidInvoice(raw)).toThrow(ProviderError);
    }
  });
});

describe("mapFakturoidPayments", () => {
  it("takes payments from the invoice they belong to", () => {
    const paid = invoice({ status: "paid", paid_on: "2023-12-08", payments: [paymentExample] });
    expect(mapFakturoidPayments(paid)).toEqual([
      {
        source: "fakturoid",
        externalId: "2",
        sourceUpdatedAt: new Date("2024-01-15T16:32:08.890+01:00"),
        invoiceExternalId: "27",
        paidOn: "2023-12-08",
        amountMinor: 121_000n,
        currency: "CZK",
      },
    ]);
    expect(mapFakturoidPayments(invoice())).toEqual([]);
    expect(
      mapFakturoidPayments(invoice({ document_type: "tax_document", payments: [paymentExample] })),
    ).toEqual([]);
  });
});

describe("mapFakturoidSubject", () => {
  it("maps the documented example subject", () => {
    expect(mapFakturoidSubject(subjectExample)).toEqual({
      source: "fakturoid",
      externalId: "16",
      sourceUpdatedAt: new Date("2023-08-22T10:59:00.330+02:00"),
      name: "Apple Czech s.r.o.",
      ico: "28897501",
      dic: "CZ28897501",
      street: "Klimentská 1216/46",
      city: "Praha",
      postalCode: "11000",
      country: "CZ",
      email: "pokus@test.cz",
      phone: null,
    });
  });

  it("turns empty and invalid values into null", () => {
    const mapped = mapFakturoidSubject({ ...subjectExample, email: "", country: "Czechia" });
    expect(mapped).toMatchObject({ email: null, country: null });
  });
});

describe("FakturoidProvider", () => {
  it("sends the token, the documented User-Agent and asks for JSON", async () => {
    const { calls, provider: fakturoid } = provider(() => ({
      status: 200,
      body: [invoiceExample],
    }));
    await fakturoid.listInvoices();

    const [call] = calls;
    expect(call?.url.toString()).toBe(
      "https://app.fakturoid.cz/api/v3/accounts/applecorp/invoices.json?page=1",
    );
    expect(call?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(call?.headers.get("user-agent")).toBe("Bystro (vyvoj@bystro.example)");
    expect(call?.headers.get("accept")).toBe("application/json");
  });

  it("pages by 40 and passes updated_since", async () => {
    const full = Array.from({ length: 40 }, (_, index) => invoice({ id: 1000 + index }));
    const { calls, provider: fakturoid } = provider((url) =>
      url.searchParams.get("page") === "1"
        ? { status: 200, body: full }
        : { status: 200, body: [invoiceExample] },
    );
    const since = new Date("2026-10-01T00:00:00Z");

    const first = await fakturoid.listInvoices({ updatedSince: since });
    expect(first.items).toHaveLength(40);
    expect(first.nextCursor).toBe("2");
    expect(calls[0]?.url.searchParams.get("updated_since")).toBe("2026-10-01T00:00:00.000Z");

    const second = await fakturoid.listInvoices({ cursor: first.nextCursor, updatedSince: since });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    await expect(fakturoid.listInvoices({ cursor: "../x" })).rejects.toThrow(RangeError);
  });

  it("does not count skipped tax documents as the end of the list", async () => {
    const page = Array.from({ length: 40 }, (_, index) =>
      invoice({ id: 2000 + index, document_type: index === 0 ? "tax_document" : "invoice" }),
    );
    const { provider: fakturoid } = provider(() => ({ status: 200, body: page }));
    const result = await fakturoid.listInvoices();
    expect(result.items).toHaveLength(39);
    expect(result.nextCursor).toBe("2");
  });

  it("lists payments from the invoices of a page", async () => {
    const { provider: fakturoid } = provider(() => ({
      status: 200,
      body: [invoice({ payments: [paymentExample] }), invoice({ id: 28 })],
    }));
    const result = await fakturoid.listPayments();
    expect(result.items.map((payment) => payment.invoiceExternalId)).toEqual(["27"]);
  });

  it("lists clients and gets one invoice, or null when it no longer exists", async () => {
    const { calls, provider: fakturoid } = provider((url) => {
      if (url.pathname.endsWith("/subjects.json")) return { status: 200, body: [subjectExample] };
      if (url.pathname.endsWith("/invoices/27.json")) return { status: 200, body: invoiceExample };
      return { status: 404, body: { error: "not_found" } };
    });

    expect((await fakturoid.listClients()).items[0]?.name).toBe("Apple Czech s.r.o.");
    expect((await fakturoid.getInvoice("27"))?.number).toBe("2023-0021");
    expect(await fakturoid.getInvoice("99")).toBeNull();
    // Ids that cannot exist never reach the API.
    expect(await fakturoid.getInvoice("27/../../x")).toBeNull();
    expect(calls.some((call) => call.url.pathname.includes(".."))).toBe(false);
  });

  it("refuses an account slug that could change the path", () => {
    const client = new FakturoidClient({ accessToken: new Secret(TOKEN), userAgent: USER_AGENT });
    expect(() => new FakturoidProvider(client, "../other")).toThrow(RangeError);
  });

  it("downloads the PDF, waiting while Fakturoid still generates it", async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const { calls, provider: fakturoid } = provider(() => [
      { status: 204 },
      { status: 204 },
      { status: 200, body: pdf, headers: { "content-type": "application/pdf" } },
    ]);

    const document = await fakturoid.getDocument("27");
    expect(document).toEqual({
      fileName: "faktura-27.pdf",
      contentType: "application/pdf",
      content: pdf,
    });
    expect(calls).toHaveLength(3);
    expect(calls[0]?.url.pathname).toBe("/api/v3/accounts/applecorp/invoices/27/download.pdf");
  });

  it("gives up on a PDF that never gets ready, so it can be tried later", async () => {
    const { provider: fakturoid } = provider(() => ({ status: 204 }));
    expect((await providerError(fakturoid.getDocument("27"))).code).toBe("provider_unavailable");
  });
});

describe("errors", () => {
  const failing = (route: Route) => provider(() => route).provider;

  it("401 means the user has to connect again", async () => {
    const error = await providerError(failing({ status: 401 }).listInvoices());
    expect(error).toMatchObject({ code: "reauth_required", retryable: false });
  });

  it("402 means Fakturoid blocked the account; 403 means no permission", async () => {
    expect((await providerError(failing({ status: 402 }).listInvoices())).code).toBe(
      "account_blocked",
    );
    expect((await providerError(failing({ status: 403 }).listClients())).code).toBe("forbidden");
  });

  it("429 says how long to wait, from the documented rate-limit header", async () => {
    const error = await providerError(
      failing({
        status: 429,
        headers: {
          "X-RateLimit-Policy": "default;q=400;w=60",
          "X-RateLimit": "default;r=0;t=55",
        },
      }).listInvoices(),
    );
    expect(error).toMatchObject({ code: "rate_limited", retryable: true, retryAfterMs: 55_000 });
  });

  it("5xx, maintenance and network failures are worth retrying", async () => {
    for (const status of [500, 502, 503]) {
      const error = await providerError(failing({ status }).listInvoices());
      expect(error).toMatchObject({ code: "provider_unavailable", retryable: true });
    }
    const offline = new FakturoidClient({
      accessToken: new Secret(TOKEN),
      userAgent: USER_AGENT,
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    const error = await providerError(new FakturoidProvider(offline, "applecorp").listInvoices());
    expect(error.code).toBe("provider_unavailable");
  });

  it("a body that is not what the documentation describes is invalid", async () => {
    expect(
      (await providerError(failing({ status: 200, body: { oops: true } }).listInvoices())).code,
    ).toBe("invalid_response");
    expect(
      (await providerError(failing({ status: 422, body: { errors: {} } }).listInvoices())).code,
    ).toBe("invalid_response");
  });

  it("never puts the token or the response into the error", async () => {
    const error = await providerError(
      failing({
        status: 401,
        body: { error: "unauthorized", error_description: "token x" },
      }).listInvoices(),
    );
    const everything = JSON.stringify({ message: error.message, error, stack: error.stack });
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain("error_description");
  });
});

describe("rateLimitWaitMs", () => {
  it("falls back to Retry-After and then to a whole window", () => {
    expect(rateLimitWaitMs(new Headers({ "retry-after": "7" }))).toBe(7_000);
    expect(rateLimitWaitMs(new Headers())).toBe(60_000);
  });
});

describe("listFakturoidAccounts", () => {
  it("lists the accounts of the token's user from the documented example", async () => {
    const { calls, client } = provider(() => ({ status: 200, body: userExample }));
    expect(await listFakturoidAccounts(client)).toEqual([
      {
        slug: "applecorp",
        name: "Alexandr Hejsek",
        registrationNo: "87654321",
        permission: "owner",
        allowedScope: ["invoices", "expenses", "reports"],
      },
    ]);
    expect(calls[0]?.url.toString()).toBe("https://app.fakturoid.cz/api/v3/user.json");
  });
});

describe("fakturoidUserAgent and fakturoidOAuthConfig", () => {
  it("builds the documented User-Agent and refuses something that is not an e-mail", () => {
    expect(USER_AGENT).toBe("Bystro (vyvoj@bystro.example)");
    expect(() => fakturoidUserAgent("")).toThrow(RangeError);
    expect(() => fakturoidUserAgent("x) (y@z.cz")).toThrow(RangeError);
  });

  it("describes the documented OAuth flow: Basic client auth, no PKCE, no scopes", () => {
    const config = fakturoidOAuthConfig({
      clientId: "client-id",
      clientSecret: new Secret("client-secret"),
      userAgent: USER_AGENT,
    });
    expect(config).toMatchObject({
      id: "fakturoid",
      authorizationEndpoint: "https://app.fakturoid.cz/api/v3/oauth",
      tokenEndpoint: "https://app.fakturoid.cz/api/v3/oauth/token",
      scopes: [],
      pkce: "none",
      clientAuthentication: "basic",
      tokenRequestHeaders: { "User-Agent": USER_AGENT },
    });
    expect(JSON.stringify(config)).not.toContain("client-secret");
  });
});

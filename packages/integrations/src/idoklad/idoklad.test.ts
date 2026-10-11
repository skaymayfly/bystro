import { ProviderError, Secret } from "@bystro/core";
import { describe, expect, it } from "vitest";

import { createAuthorizationRequest, refreshAccessToken } from "../oauth/oauth";
import { IdokladClient } from "./client";
// Example responses copied from the iDoklad API v3 documentation on 2026-10-11 (lists of
// issued invoices, proforma invoices, credit notes, contacts, payments, currencies and
// countries, and the current agenda). They are not recorded from a real account; variants
// used below are derived from them field by field.
import contactsExample from "./fixtures/contacts.json";
import countriesExample from "./fixtures/countries.json";
import creditNotesExample from "./fixtures/credit-notes.json";
import currenciesExample from "./fixtures/currencies.json";
import agendaExample from "./fixtures/current-agenda.json";
import invoicesExample from "./fixtures/issued-invoices.json";
import paymentsExample from "./fixtures/payments.json";
import proformasExample from "./fixtures/proforma-invoices.json";
import {
  getIdokladAgenda,
  IdokladLists,
  idokladOAuthConfig,
  IdokladProvider,
  mapIdokladContact,
  mapIdokladCreditNote,
  mapIdokladInvoice,
  mapIdokladPayment,
  mapIdokladProforma,
  revokeIdokladAccess,
  type IdokladListValues,
} from "./idoklad";

const TOKEN = "access-token-plaintext";
const CREDENTIALS = { clientId: "client-id", clientSecret: new Secret("client-secret-plaintext") };

const LISTS: IdokladListValues = {
  currencies: new Map([
    [1, "CZK"],
    [2, "EUR"],
  ]),
  countries: new Map([
    [1, "CZ"],
    [2, "SK"],
  ]),
};

type Json = Record<string, unknown>;

const invoiceExample = invoicesExample.Data.Items[0] as Json;
const proformaExample = proformasExample.Data.Items[0] as Json;
const creditNoteExample = creditNotesExample.Data.Items[0] as Json;
const paymentExample = paymentsExample.Data.Items[0] as Json;
const contactExample = contactsExample.Data.Items[0] as Json;

/** The documentation's invoice with the values of a real-looking one: 10 000 Kč + 21 % VAT. */
function invoice(overrides: Json = {}, prices: Json = {}): Json {
  return {
    ...invoiceExample,
    Id: 16,
    DocumentNumber: "20260012",
    VariableSymbol: "20260012",
    CurrencyId: 1,
    PartnerId: 24,
    DateOfIssue: "2026-09-30",
    DateOfTaxing: "2026-09-30",
    DateOfMaturity: "2026-10-14",
    DateOfPayment: "2026-10-02",
    PaymentStatus: 0,
    Prices: {
      ...(invoiceExample.Prices as Json),
      TotalWithoutVat: 10000.0,
      TotalVat: 2100.0,
      TotalWithVat: 12100.0,
      TotalPaid: 0.0,
      ...prices,
    },
    Items: [
      {
        ...((invoiceExample.Items as Json[])[0] as Json),
        Id: 5,
        Name: "Malířské práce",
        Amount: 12.5,
        Unit: "hod",
        PriceType: 1,
        VatRate: 21.0,
        Prices: { UnitPrice: 800.0, TotalWithVat: 12100.0 },
      },
    ],
    Metadata: { DateCreated: "2026-09-30T14:26:53.707", DateLastChange: "2026-10-01T08:15:00.5" },
    ...overrides,
  };
}

const envelope = (data: unknown) => ({
  Data: data,
  ErrorCode: 0,
  IsSuccess: true,
  StatusCode: 200,
});
const page = (items: unknown[], totalPages = 1) =>
  envelope({ Items: items, TotalItems: items.length, TotalPages: totalPages });

type Route = { status: number; body?: unknown; headers?: Record<string, string> };

/** A fake `fetch` answering by URL; records every request. */
function fakeFetch(routes: (url: URL) => Route) {
  const calls: { url: URL; headers: Headers; method: string; body: string }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({
      url,
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
      body: init?.body === undefined || init.body === null ? "" : String(init.body),
    });
    const answer = routes(url);
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: answer.headers ?? {},
    });
  }) as typeof fetch;
  return { calls, fetchFn };
}

const LIST_ROUTES: Record<string, Route> = {
  "/v3/Currencies": {
    status: 200,
    body: page([
      { ...currenciesExample.Data.Items[0], Id: 1, Code: "CZK" },
      { ...currenciesExample.Data.Items[0], Id: 2, Code: "EUR" },
    ]),
  },
  "/v3/Countries": {
    status: 200,
    body: page([
      { ...countriesExample.Data.Items[0], Id: 1, Code: "CZE" },
      { ...countriesExample.Data.Items[0], Id: 2, Code: "SVK" },
      { ...countriesExample.Data.Items[0], Id: 3, Code: "XXX" },
    ]),
  },
};

function provider(routes: (url: URL) => Route | undefined) {
  const fake = fakeFetch(
    (url) => routes(url) ?? LIST_ROUTES[url.pathname] ?? { status: 404, body: {} },
  );
  const client = new IdokladClient({ accessToken: new Secret(TOKEN), fetch: fake.fetchFn });
  return { ...fake, client, provider: new IdokladProvider(client, new IdokladLists()) };
}

async function providerError(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    return error as ProviderError;
  }
  throw new Error("Expected a ProviderError.");
}

const errorCode = (map: () => unknown) => {
  try {
    map();
  } catch (error) {
    return error instanceof ProviderError ? error.code : "other";
  }
  return "none";
};

describe("idokladOAuthConfig", () => {
  it("follows the documented authorization code flow, with PKCE", () => {
    const config = idokladOAuthConfig(CREDENTIALS);

    expect(config.authorizationEndpoint).toBe(
      "https://identity.idoklad.cz/server/connect/authorize",
    );
    expect(config.tokenEndpoint).toBe("https://identity.idoklad.cz/server/connect/token");
    expect(config.clientAuthentication).toBe("body");
    expect(config.pkce).toBe("S256");

    const redirectUri = "https://bystro.example/api/integrations/idoklad/callback";
    const request = createAuthorizationRequest(config, {
      redirectUri,
      allowedRedirectUris: [redirectUri],
    });
    const url = new URL(request.url);
    expect(url.searchParams.get("scope")).toBe("idoklad_api offline_access");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(request.url).not.toContain("client-secret-plaintext");
  });

  it("sends the credentials and scopes in the body and keeps the rotated refresh token", async () => {
    const fake = fakeFetch(() => ({
      status: 200,
      body: {
        access_token: "new-access",
        expires_in: 6000,
        token_type: "Bearer",
        refresh_token: "new-refresh",
      },
    }));
    const now = new Date("2026-10-11T08:00:00Z");

    const tokens = await refreshAccessToken(
      idokladOAuthConfig(CREDENTIALS),
      { refreshToken: new Secret("old-refresh") },
      { fetch: fake.fetchFn, now },
    );

    const body = new URLSearchParams(fake.calls[0]?.body);
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "old-refresh",
      client_id: "client-id",
      client_secret: "client-secret-plaintext",
      scope: "idoklad_api offline_access",
    });
    expect(fake.calls[0]?.headers.get("authorization")).toBeNull();
    expect(tokens.refreshToken?.reveal()).toBe("new-refresh");
    expect(tokens.expiresAt).toEqual(new Date("2026-10-11T09:40:00Z"));
  });
});

describe("revokeIdokladAccess", () => {
  it("posts the refresh token to the revocation endpoint", async () => {
    const fake = fakeFetch(() => ({ status: 200 }));

    const revoked = await revokeIdokladAccess(CREDENTIALS, new Secret("refresh-plaintext"), {
      fetch: fake.fetchFn,
    });

    expect(revoked).toBe(true);
    expect(fake.calls[0]?.url.toString()).toBe(
      "https://identity.idoklad.cz/server/connect/revocation",
    );
    expect(fake.calls[0]?.method).toBe("POST");
    expect(Object.fromEntries(new URLSearchParams(fake.calls[0]?.body))).toEqual({
      token: "refresh-plaintext",
      token_type_hint: "refresh_token",
      client_id: "client-id",
      client_secret: "client-secret-plaintext",
    });
  });

  it("reports a failure without throwing", async () => {
    const refused = fakeFetch(() => ({ status: 400 }));
    expect(
      await revokeIdokladAccess(CREDENTIALS, new Secret("r"), { fetch: refused.fetchFn }),
    ).toBe(false);

    const offline = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await revokeIdokladAccess(CREDENTIALS, new Secret("r"), { fetch: offline })).toBe(false);
  });
});

describe("IdokladClient", () => {
  it("sends the bearer token and unwraps Data", async () => {
    const fake = fakeFetch(() => ({ status: 200, body: envelope({ answer: 42 }) }));
    const client = new IdokladClient({ accessToken: new Secret(TOKEN), fetch: fake.fetchFn });

    expect(await client.getData("/Account/CurrentAgenda", { page: "1" })).toEqual({ answer: 42 });
    expect(fake.calls[0]?.url.toString()).toBe(
      "https://api.idoklad.cz/v3/Account/CurrentAgenda?page=1",
    );
    expect(fake.calls[0]?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it.each([
    [401, "reauth_required"],
    [402, "account_blocked"],
    [403, "account_blocked"],
    [600, "account_blocked"],
    [429, "rate_limited"],
    [500, "provider_unavailable"],
    [503, "provider_unavailable"],
    [400, "invalid_response"],
    [404, "invalid_response"],
  ])("turns HTTP %i into %s", async (status, code) => {
    // Node refuses to build a Response with a status above 599.
    const fetchFn = (async () =>
      ({
        ok: false,
        status,
        headers: new Headers(),
        json: async () => ({ Message: `secret detail ${TOKEN}` }),
      }) as unknown as Response) as typeof fetch;
    const client = new IdokladClient({ accessToken: new Secret(TOKEN), fetch: fetchFn });

    const error = await providerError(client.getData("/IssuedInvoices"));

    expect(error.code).toBe(code);
    expect(error.message).not.toContain(TOKEN);
    expect(error.message).not.toContain("secret detail");
  });

  it("waits as long as Retry-After says, or a minute", async () => {
    const withHeader = fakeFetch(() => ({ status: 429, headers: { "Retry-After": "17" } }));
    const first = await providerError(
      new IdokladClient({ accessToken: new Secret(TOKEN), fetch: withHeader.fetchFn }).getData(
        "/x",
      ),
    );
    expect(first.retryAfterMs).toBe(17_000);

    const without = fakeFetch(() => ({ status: 429 }));
    const second = await providerError(
      new IdokladClient({ accessToken: new Secret(TOKEN), fetch: without.fetchFn }).getData("/x"),
    );
    expect(second.retryAfterMs).toBe(60_000);
  });

  it("treats a network failure as an outage and never leaks the cause", async () => {
    const fetchFn = (async () => {
      throw new Error(`connect ECONNREFUSED with ${TOKEN}`);
    }) as unknown as typeof fetch;
    const client = new IdokladClient({ accessToken: new Secret(TOKEN), fetch: fetchFn });

    const error = await providerError(client.getData("/IssuedInvoices"));

    expect(error.code).toBe("provider_unavailable");
    expect(error.message).not.toContain(TOKEN);
  });

  it("refuses a response without the documented wrapper", async () => {
    const bare = fakeFetch(() => ({ status: 200, body: [1, 2, 3] }));
    const failed = fakeFetch(() => ({ status: 200, body: { Data: null, IsSuccess: false } }));
    for (const fake of [bare, failed]) {
      const client = new IdokladClient({ accessToken: new Secret(TOKEN), fetch: fake.fetchFn });
      expect((await providerError(client.getData("/IssuedInvoices"))).code).toBe(
        "invalid_response",
      );
    }
  });

  it("returns null for 404 only when asked to", async () => {
    const fake = fakeFetch(() => ({ status: 404, body: {} }));
    const client = new IdokladClient({ accessToken: new Secret(TOKEN), fetch: fake.fetchFn });

    expect(await client.getData("/IssuedInvoices/1", {}, { allowNotFound: true })).toBeNull();
  });
});

describe("mapping documents", () => {
  it("maps the documentation's example as it stands", () => {
    // The example's values are placeholders; this checks that its shape is accepted.
    const mapped = mapIdokladInvoice(invoiceExample, LISTS);

    expect(mapped.externalId).toBe(`invoice-${String(invoiceExample.Id)}`);
    expect(mapped.currency).toBe("CZK");
    expect(mapped.issuedOn).toBe("2026-09-30");
  });

  it("maps an unpaid invoice to haléře, dates and lines", () => {
    expect(mapIdokladInvoice(invoice(), LISTS)).toEqual({
      source: "idoklad",
      externalId: "invoice-16",
      sourceUpdatedAt: new Date("2026-10-01T08:15:00.500Z"),
      number: "20260012",
      variableSymbol: "20260012",
      kind: "invoice",
      direction: "issued",
      sourceStatus: "open",
      clientExternalId: "24",
      issuedOn: "2026-09-30",
      taxableSupplyOn: "2026-09-30",
      dueOn: "2026-10-14",
      // Not paid: the payment date is not taken over.
      paidOn: null,
      currency: "CZK",
      subtotalMinor: 1_000_000n,
      vatMinor: 210_000n,
      totalMinor: 1_210_000n,
      lines: [
        {
          externalId: "5",
          position: 1,
          description: "Malířské práce",
          quantityMilli: 12_500,
          unit: "hod",
          unitPriceMinor: 80_000n,
          vatRateBasisPoints: 2100,
          totalMinor: 1_210_000n,
        },
      ],
      // Nothing paid: no need to ask for payments.
      payments: [],
    });
  });

  it.each([
    [0.07, 7n],
    [0.1, 10n],
    [0.29, 29n],
    [1.15, 115n],
    [9133.6, 913_360n],
    [1234.56, 123_456n],
    [19999.99, 1_999_999n],
    [123456789.01, 12_345_678_901n],
    [-2420.0, -242_000n],
  ])("converts %d exactly, without floating-point arithmetic", (amount, expected) => {
    const mapped = mapIdokladInvoice(invoice({}, { TotalWithVat: amount }), LISTS);
    expect(mapped.totalMinor).toBe(expected);
  });

  it("refuses amounts it could not convert exactly", () => {
    for (const amount of [12.345, 1e13, 1e21]) {
      expect(errorCode(() => mapIdokladInvoice(invoice({}, { TotalWithVat: amount }), LISTS))).toBe(
        "invalid_response",
      );
    }
  });

  it("maps the payment status", () => {
    const paid = mapIdokladInvoice(invoice({ PaymentStatus: 1 }, { TotalPaid: 12100.0 }), LISTS);
    expect(paid.sourceStatus).toBe("paid");
    expect(paid.paidOn).toBe("2026-10-02");
    expect(paid.payments).toBeNull();

    const partial = mapIdokladInvoice(invoice({ PaymentStatus: 2 }, { TotalPaid: 5000.0 }), LISTS);
    expect(partial.sourceStatus).toBe("open");
    expect(partial.paidOn).toBeNull();
    expect(partial.payments).toBeNull();

    expect(mapIdokladInvoice(invoice({ PaymentStatus: 3 }), LISTS).sourceStatus).toBe("paid");
    expect(errorCode(() => mapIdokladInvoice(invoice({ PaymentStatus: 9 }), LISTS))).toBe(
      "invalid_response",
    );
  });

  it("reads days given with a time", () => {
    const mapped = mapIdokladInvoice(
      invoice({
        DateOfIssue: "2026-09-30T00:00:00",
        DateOfTaxing: "2026-09-30T00:00:00.000Z",
        // A moment in UTC that is already the next day in Prague.
        DateOfMaturity: "2026-10-14T22:30:00",
      }),
      LISTS,
    );

    expect(mapped.issuedOn).toBe("2026-09-30");
    expect(mapped.taxableSupplyOn).toBe("2026-09-30");
    expect(mapped.dueOn).toBe("2026-10-15");
  });

  it("keeps a unit price entered with VAT only when the rate is zero", () => {
    const item = (invoice().Items as Json[])[0] as Json;
    const withVat = mapIdokladInvoice(invoice({ Items: [{ ...item, PriceType: 0 }] }), LISTS);
    expect(withVat.lines[0]?.unitPriceMinor).toBeNull();

    const zeroRate = mapIdokladInvoice(
      invoice({ Items: [{ ...item, PriceType: 0, VatRate: 0.0 }] }),
      LISTS,
    );
    expect(zeroRate.lines[0]?.unitPriceMinor).toBe(80_000n);
    expect(zeroRate.lines[0]?.vatRateBasisPoints).toBe(0);
  });

  it("leaves out line details it cannot keep exactly, but not the line", () => {
    const item = (invoice().Items as Json[])[0] as Json;
    const mapped = mapIdokladInvoice(
      invoice({
        Items: [
          {
            ...item,
            Id: null,
            Amount: 0.33333,
            Prices: { UnitPrice: 12.3456, TotalWithVat: 4.11 },
          },
        ],
      }),
      LISTS,
    );

    expect(mapped.lines[0]).toMatchObject({
      externalId: "invoice-16#1",
      quantityMilli: null,
      unitPriceMinor: null,
      totalMinor: 411n,
    });
  });

  it("drops what our model does not accept and refuses what it cannot do without", () => {
    const mapped = mapIdokladInvoice(
      invoice({ VariableSymbol: "FV-2026/12", PartnerId: 0, DateOfTaxing: null, Items: null }),
      LISTS,
    );
    expect(mapped.variableSymbol).toBeNull();
    expect(mapped.clientExternalId).toBeNull();
    expect(mapped.taxableSupplyOn).toBeNull();
    expect(mapped.lines).toEqual([]);

    for (const broken of [
      invoice({ CurrencyId: 999 }),
      invoice({ DateOfMaturity: "14. 10. 2026" }),
      invoice({ DocumentNumber: "" }),
      invoice({ Id: "16" }),
      invoice({}, { TotalWithVat: "12100.00" }),
      "not an object",
    ]) {
      expect(errorCode(() => mapIdokladInvoice(broken, LISTS))).toBe("invalid_response");
    }
  });

  it("gives proforma invoices and credit notes their own ids and kinds", () => {
    const proforma = mapIdokladProforma(proformaExample, LISTS);
    expect(proforma.kind).toBe("proforma");
    expect(proforma.externalId).toBe(`proforma-${String(proformaExample.Id)}`);

    const creditNote = mapIdokladCreditNote(
      {
        ...creditNoteExample,
        Id: 16,
        CurrencyId: 1,
        Prices: {
          ...(creditNoteExample.Prices as Json),
          TotalWithoutVat: -2000.0,
          TotalVat: -420.0,
          TotalWithVat: -2420.0,
          TotalPaid: 0.0,
        },
      },
      LISTS,
    );
    expect(creditNote.kind).toBe("credit_note");
    // The same number as an invoice's id, yet a different object.
    expect(creditNote.externalId).toBe("credit-16");
    expect(creditNote.totalMinor).toBe(-242_000n);
  });
});

describe("mapping payments and contacts", () => {
  const payment = (overrides: Json = {}) => ({
    ...paymentExample,
    Id: 6,
    InvoiceId: 16,
    DocumentType: 0,
    CurrencyId: 1,
    DateOfPayment: "2026-10-02T00:00:00",
    Prices: { PaymentAmount: 5000.5, PaymentAmountHc: 5000.5 },
    Metadata: { DateLastChange: "2026-10-02T09:00:00" },
    ...overrides,
  });

  it("maps a payment of an invoice", () => {
    expect(mapIdokladPayment(payment(), LISTS)).toEqual({
      source: "idoklad",
      externalId: "6",
      sourceUpdatedAt: new Date("2026-10-02T09:00:00Z"),
      invoiceExternalId: "invoice-16",
      paidOn: "2026-10-02",
      amountMinor: 500_050n,
      currency: "CZK",
    });
  });

  it("points payments of proforma invoices and credit notes at the right document", () => {
    expect(mapIdokladPayment(payment({ DocumentType: 1 }), LISTS)?.invoiceExternalId).toBe(
      "proforma-16",
    );
    expect(mapIdokladPayment(payment({ DocumentType: 3 }), LISTS)?.invoiceExternalId).toBe(
      "credit-16",
    );
  });

  it("skips payments of documents Bystro does not track", () => {
    // 6 = sales receipt.
    expect(mapIdokladPayment(payment({ DocumentType: 6 }), LISTS)).toBeNull();
  });

  it("maps the documentation's example payment as it stands", () => {
    expect(mapIdokladPayment(paymentExample, LISTS)).toMatchObject({
      externalId: String(paymentExample.Id),
      paidOn: "2026-09-30",
    });
  });

  it("maps a contact", () => {
    const mapped = mapIdokladContact(
      {
        ...contactExample,
        Id: 24,
        CompanyName: "  Stavby Novák s.r.o. ",
        IdentificationNumber: "27074358",
        VatIdentificationNumber: "CZ27074358",
        Street: "Dlouhá 12",
        City: "Brno",
        PostalCode: "602 00",
        CountryId: 1,
        Email: "fakturace@novak.example",
        Phone: "",
        Mobile: "+420 777 123 456",
        Metadata: { DateLastChange: "2026-09-01T10:00:00" },
      },
      LISTS,
    );

    expect(mapped).toEqual({
      source: "idoklad",
      externalId: "24",
      sourceUpdatedAt: new Date("2026-09-01T10:00:00Z"),
      name: "Stavby Novák s.r.o.",
      ico: "27074358",
      dic: "CZ27074358",
      street: "Dlouhá 12",
      city: "Brno",
      postalCode: "602 00",
      country: "CZ",
      email: "fakturace@novak.example",
      phone: "+420 777 123 456",
    });
  });

  it("names a contact without a company after the person, or by its id", () => {
    const person = { Id: 7, CompanyName: "", Firstname: "Jana", Surname: "Malá", CountryId: 77 };
    expect(mapIdokladContact(person, LISTS)).toMatchObject({ name: "Jana Malá", country: null });
    expect(mapIdokladContact({ Id: 8 }, LISTS).name).toBe("Kontakt 8");
  });
});

describe("IdokladProvider", () => {
  it("lists invoices, proforma invoices and credit notes behind one cursor", async () => {
    const { provider: idoklad, calls } = provider((url) => {
      if (url.pathname === "/v3/IssuedInvoices") {
        return url.searchParams.get("page") === "1"
          ? { status: 200, body: page([invoice({ Id: 1 })], 2) }
          : { status: 200, body: page([invoice({ Id: 2 })], 2) };
      }
      if (url.pathname === "/v3/ProformaInvoices") {
        return { status: 200, body: page([invoice({ Id: 1 })]) };
      }
      if (url.pathname === "/v3/CreditNotes") {
        return { status: 200, body: page([]) };
      }
      return undefined;
    });

    const seen: string[] = [];
    const cursors: (string | null)[] = [];
    let cursor: string | null = null;
    do {
      const batch = await idoklad.listInvoices({ cursor });
      seen.push(...batch.items.map((item) => item.externalId));
      cursor = batch.nextCursor;
      cursors.push(cursor);
    } while (cursor !== null);

    expect(seen).toEqual(["invoice-1", "invoice-2", "proforma-1"]);
    expect(cursors).toEqual(["invoice:2", "proforma:1", "credit:1", null]);
    const documentCalls = calls.filter((call) => !(call.url.pathname in LIST_ROUTES));
    expect(documentCalls.map((call) => call.url.pathname + call.url.search)).toEqual([
      "/v3/IssuedInvoices?page=1&pagesize=200",
      "/v3/IssuedInvoices?page=2&pagesize=200",
      "/v3/ProformaInvoices?page=1&pagesize=200",
      "/v3/CreditNotes?page=1&pagesize=200",
    ]);
  });

  it("asks for the currency and country lists only once", async () => {
    const { provider: idoklad, calls } = provider((url) =>
      url.pathname in LIST_ROUTES ? undefined : { status: 200, body: page([]) },
    );

    await idoklad.listInvoices();
    await idoklad.listInvoices({ cursor: "proforma:1" });
    await idoklad.listClients();

    expect(calls.filter((call) => call.url.pathname === "/v3/Currencies")).toHaveLength(1);
    expect(calls.filter((call) => call.url.pathname === "/v3/Countries")).toHaveLength(1);
  });

  it("loads the lists again after a failure and after a day", async () => {
    let currencyStatus = 500;
    let time = 0;
    const fake = fakeFetch((url) =>
      url.pathname === "/v3/Currencies" && currencyStatus !== 200
        ? { status: currencyStatus }
        : (LIST_ROUTES[url.pathname] ?? { status: 200, body: page([]) }),
    );
    const client = new IdokladClient({ accessToken: new Secret(TOKEN), fetch: fake.fetchFn });
    const lists = new IdokladLists(() => time);
    const currencyCalls = () =>
      fake.calls.filter((call) => call.url.pathname === "/v3/Currencies").length;

    expect((await providerError(lists.get(client))).code).toBe("provider_unavailable");
    currencyStatus = 200;
    expect((await lists.get(client)).currencies.get(1)).toBe("CZK");
    expect((await lists.get(client)).countries.get(2)).toBe("SK");
    // A country outside our table is unknown, not an error.
    expect((await lists.get(client)).countries.has(3)).toBe(false);
    expect(currencyCalls()).toBe(2);

    time = 25 * 60 * 60 * 1000;
    await lists.get(client);
    expect(currencyCalls()).toBe(3);
  });

  it("filters by the time of change and by the date of issue", async () => {
    const { provider: idoklad, calls } = provider((url) =>
      url.pathname in LIST_ROUTES ? undefined : { status: 200, body: page([]) },
    );

    await idoklad.listInvoices({ updatedSince: new Date("2026-10-11T06:55:00Z") });
    await idoklad.listInvoices({ createdSince: new Date("2025-10-11T08:00:00Z") });
    await idoklad.listClients({ updatedSince: new Date("2026-10-11T06:55:00Z") });

    const filters = calls
      .filter((call) => !(call.url.pathname in LIST_ROUTES))
      .map((call) => `${call.url.pathname} ${call.url.searchParams.get("filter")}`);
    expect(filters).toEqual([
      "/v3/IssuedInvoices (DateLastChange~gte~2026-10-11T06:55:00.000)",
      "/v3/IssuedInvoices (DateOfIssue~gte~2025-10-11T08:00:00.000)",
      "/v3/Contacts (DateLastChange~gte~2026-10-11T06:55:00.000)",
    ]);
  });

  it("refuses a cursor it did not issue", async () => {
    const { provider: idoklad, calls } = provider(() => ({ status: 200, body: page([]) }));

    for (const cursor of ["invoice", "invoice:0", "receipt:1", "invoice:1:2", "2"]) {
      await expect(idoklad.listInvoices({ cursor })).rejects.toBeInstanceOf(RangeError);
    }
    await expect(idoklad.listClients({ cursor: "invoice:1" })).rejects.toBeInstanceOf(RangeError);
    expect(calls).toHaveLength(0);
  });

  it("gets one document by our id and says when it is gone", async () => {
    const { provider: idoklad, calls } = provider((url) => {
      if (url.pathname === "/v3/CreditNotes/16") {
        return { status: 200, body: envelope(invoice()) };
      }
      if (url.pathname === "/v3/IssuedInvoices/404") {
        return { status: 404, body: {} };
      }
      return undefined;
    });

    expect((await idoklad.getInvoice("credit-16"))?.externalId).toBe("credit-16");
    expect(await idoklad.getInvoice("invoice-404")).toBeNull();

    const before = calls.length;
    for (const id of ["16", "receipt-1", "invoice-1/../2", "invoice-0", "invoice-"]) {
      expect(await idoklad.getInvoice(id)).toBeNull();
    }
    expect(calls).toHaveLength(before);
  });

  it("fetches the payments of the given documents only", async () => {
    const payment = (id: number, invoiceId: number, documentType: number) => ({
      ...paymentExample,
      Id: id,
      InvoiceId: invoiceId,
      DocumentType: documentType,
      CurrencyId: 1,
    });
    const { provider: idoklad, calls } = provider((url) =>
      url.pathname === "/v3/IssuedDocumentPayments"
        ? {
            status: 200,
            // The filter is by number only: a proforma invoice with the same id comes too.
            body: page([
              payment(1, 16, 0),
              payment(2, 16, 1),
              payment(3, 20, 3),
              payment(4, 16, 6),
            ]),
          }
        : undefined,
    );

    const result = await idoklad.listPayments({
      invoiceExternalIds: ["invoice-16", "credit-20", "not-ours"],
    });

    expect(result.items.map((item) => [item.externalId, item.invoiceExternalId])).toEqual([
      ["1", "invoice-16"],
      ["3", "credit-20"],
    ]);
    expect(result.nextCursor).toBeNull();
    const call = calls.find((item) => item.url.pathname === "/v3/IssuedDocumentPayments");
    expect(call?.url.searchParams.get("filter")).toBe("(InvoiceId~eq~16~or~InvoiceId~eq~20)");
  });

  it("makes no request for payments when no document of ours is asked for", async () => {
    const { provider: idoklad, calls } = provider(() => ({ status: 200, body: page([]) }));

    expect(await idoklad.listPayments({ invoiceExternalIds: [] })).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(calls).toHaveLength(0);
  });

  it("pages through all payments when no documents are given", async () => {
    const { provider: idoklad, calls } = provider((url) =>
      url.pathname === "/v3/IssuedDocumentPayments"
        ? { status: 200, body: page([{ ...paymentExample, CurrencyId: 1 }], 3) }
        : undefined,
    );

    const result = await idoklad.listPayments({
      cursor: "2",
      createdSince: new Date("2025-10-11T00:00:00Z"),
    });

    expect(result.nextCursor).toBe("3");
    const call = calls.find((item) => item.url.pathname === "/v3/IssuedDocumentPayments");
    expect(call?.url.searchParams.get("page")).toBe("2");
    expect(call?.url.searchParams.get("filter")).toBe(
      "(DateOfPayment~gte~2025-10-11T00:00:00.000)",
    );
  });

  it("returns the printed document and refuses anything that is not a PDF", async () => {
    const pdf = Buffer.from("%PDF-1.7 fake").toString("base64");
    const { provider: idoklad } = provider((url) => {
      if (url.pathname === "/v3/Reports/ProformaInvoice/3/Pdf") {
        return { status: 200, body: envelope(pdf) };
      }
      if (url.pathname === "/v3/Reports/IssuedInvoice/4/Pdf") {
        return { status: 200, body: envelope(Buffer.from("<html>").toString("base64")) };
      }
      return undefined;
    });

    const document = await idoklad.getDocument("proforma-3");
    expect(document?.fileName).toBe("proforma-3.pdf");
    expect(document?.contentType).toBe("application/pdf");
    expect(Buffer.from(document?.content ?? []).toString()).toBe("%PDF-1.7 fake");

    expect((await providerError(idoklad.getDocument("invoice-4"))).code).toBe("invalid_response");
    expect(await idoklad.getDocument("invoice-5")).toBeNull();
    expect(await idoklad.getDocument("nonsense")).toBeNull();
  });

  it("passes a provider failure on with its code", async () => {
    const { provider: idoklad } = provider((url) =>
      url.pathname === "/v3/IssuedInvoices" ? { status: 402 } : undefined,
    );

    expect((await providerError(idoklad.listInvoices())).code).toBe("account_blocked");
  });
});

describe("getIdokladAgenda", () => {
  it("reads the agenda the token belongs to", async () => {
    const fake = fakeFetch(() => ({
      status: 200,
      body: envelope({
        ...agendaExample.Data,
        Id: 4321,
        Name: "Stavby Novák s.r.o.",
        Contact: { ...agendaExample.Data.Contact, IdentificationNumber: " 27074358 " },
      }),
    }));
    const client = new IdokladClient({ accessToken: new Secret(TOKEN), fetch: fake.fetchFn });

    expect(await getIdokladAgenda(client)).toEqual({
      id: "4321",
      name: "Stavby Novák s.r.o.",
      registrationNo: "27074358",
    });
    expect(fake.calls[0]?.url.pathname).toBe("/v3/Account/CurrentAgenda");
  });

  it("refuses an answer without an id", async () => {
    const fake = fakeFetch(() => ({ status: 200, body: envelope({ Name: "Firma" }) }));
    const client = new IdokladClient({ accessToken: new Secret(TOKEN), fetch: fake.fetchFn });

    expect((await providerError(getIdokladAgenda(client))).code).toBe("invalid_response");
  });
});

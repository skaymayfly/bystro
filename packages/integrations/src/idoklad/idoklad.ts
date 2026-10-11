import {
  parseMoneyToMinor,
  parseScaledSafeInteger,
  ProviderError,
  todayInPrague,
  type Client,
  type DateOnly,
  type Invoice,
  type InvoiceDocument,
  type InvoiceKind,
  type InvoiceLine,
  type InvoicePayment,
  type InvoiceProvider,
  type InvoiceSourceStatus,
  type ListOptions,
  type Page,
  type Secret,
} from "@bystro/core";
import { z } from "zod";

import type { OAuthProviderConfig } from "../oauth/oauth";
import { IDOKLAD_IDENTITY_BASE_URL, IDOKLAD_PAGE_SIZE, type IdokladClient } from "./client";

/**
 * iDoklad as an {@link InvoiceProvider}. Documentation (read 2026-10-11),
 * https://api.idoklad.cz/Help/v3/cs/ — groups IssuedInvoices, ProformaInvoices, CreditNotes,
 * Contacts, IssuedDocumentPayments, Lists (Currencies, Countries), Account and Reports.
 *
 * Read-only: nothing here writes to iDoklad. Everything iDoklad returns is external,
 * untrusted text and is validated before use.
 */
export const IDOKLAD_SOURCE = "idoklad";

// ---------------------------------------------------------------------------------------
// OAuth (documentation: "Autorizace", groups AuthorizationCodeFlow and RefreshToken)
// ---------------------------------------------------------------------------------------

/** `idoklad_api` is the API itself, `offline_access` is what makes a refresh token come. */
export const IDOKLAD_SCOPES = ["idoklad_api", "offline_access"] as const;

export interface IdokladAppCredentials {
  /** From the application registered at https://developer.idoklad.cz. */
  clientId: string;
  clientSecret: Secret;
  /** Only for tests against a local stand-in; defaults to the real API. */
  baseUrl?: string;
  /** Only for tests against a local stand-in; defaults to the real identity server. */
  identityBaseUrl?: string;
}

/**
 * Authorization Code flow as documented: the client id and secret go in the body of the
 * token request together with the scopes. No PKCE: the documentation does not use it, and
 * although the identity server lists `code_challenge_methods_supported`, it refuses a token
 * request carrying a `code_verifier` from an application registered with the plain
 * "AuthorizationCode" flow (`invalid_grant`, seen with a real account on 2026-10-11). The
 * request is still bound to the user by `state` and to us by the client secret. Access
 * tokens live 100 minutes; a new refresh token comes with every token response and
 * replaces the previous one.
 */
export function idokladOAuthConfig(input: IdokladAppCredentials): OAuthProviderConfig {
  const identity = input.identityBaseUrl ?? IDOKLAD_IDENTITY_BASE_URL;
  return {
    id: IDOKLAD_SOURCE,
    authorizationEndpoint: `${identity}/connect/authorize`,
    tokenEndpoint: `${identity}/connect/token`,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    scopes: IDOKLAD_SCOPES,
    pkce: "none",
    clientAuthentication: "body",
    tokenRequestParams: { scope: IDOKLAD_SCOPES.join(" ") },
  };
}

/**
 * Revokes the refresh token at the identity server (`revocation_endpoint` of its OpenID
 * configuration, RFC 7009). Returns whether the server confirmed it; a failure must not
 * stop the user from disconnecting, so nothing is thrown.
 */
export async function revokeIdokladAccess(
  credentials: IdokladAppCredentials,
  refreshToken: Secret,
  options: { fetch?: typeof fetch } = {},
): Promise<boolean> {
  const identity = credentials.identityBaseUrl ?? IDOKLAD_IDENTITY_BASE_URL;
  try {
    const response = await (options.fetch ?? fetch)(`${identity}/connect/revocation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        token: refreshToken.reveal(),
        token_type_hint: "refresh_token",
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret.reveal(),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------
// Response shapes: only the fields we use. iDoklad sends many more.
// ---------------------------------------------------------------------------------------

/** Amounts come as JSON numbers (`decimalnumber`). */
const amount = z.number();
const optionalText = z.string().nullable().optional();
/** `date` fields come as `2026-09-30` or with a time part. */
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/);
const metadataSchema = z.object({ DateLastChange: optionalText }).nullable().optional();

const itemSchema = z.object({
  Id: z.number().int().nullable().optional(),
  Name: optionalText,
  Amount: amount.nullable().optional(),
  Unit: optionalText,
  PriceType: z.number().int().nullable().optional(),
  VatRate: amount.nullable().optional(),
  Prices: z.object({
    UnitPrice: amount.nullable().optional(),
    TotalWithVat: amount,
  }),
});

const documentSchema = z.object({
  Id: z.number().int().positive(),
  DocumentNumber: z.string().min(1),
  VariableSymbol: optionalText,
  CurrencyId: z.number().int(),
  PartnerId: z.number().int().nullable().optional(),
  DateOfIssue: dateText,
  DateOfTaxing: dateText.nullable().optional(),
  DateOfMaturity: dateText,
  DateOfPayment: dateText.nullable().optional(),
  PaymentStatus: z.number().int(),
  Prices: z.object({
    TotalWithVat: amount,
    TotalWithoutVat: amount,
    TotalVat: amount,
    TotalPaid: amount,
  }),
  Items: z.array(itemSchema).nullable().optional(),
  Metadata: metadataSchema,
});

const paymentSchema = z.object({
  Id: z.number().int().positive(),
  InvoiceId: z.number().int().positive(),
  DocumentType: z.number().int(),
  DateOfPayment: dateText,
  CurrencyId: z.number().int(),
  Prices: z.object({ PaymentAmount: amount }),
  Metadata: metadataSchema,
});

const contactSchema = z.object({
  Id: z.number().int().positive(),
  CompanyName: optionalText,
  Firstname: optionalText,
  Surname: optionalText,
  IdentificationNumber: optionalText,
  VatIdentificationNumber: optionalText,
  Street: optionalText,
  City: optionalText,
  PostalCode: optionalText,
  CountryId: z.number().int().nullable().optional(),
  Email: optionalText,
  Phone: optionalText,
  Mobile: optionalText,
  Metadata: metadataSchema,
});

const pageSchema = z.object({
  Items: z.array(z.unknown()),
  TotalPages: z.number().int().nonnegative(),
});

const currencySchema = z.object({ Id: z.number().int(), Code: z.string() });
const countrySchema = z.object({ Id: z.number().int(), Code: z.string() });

const agendaSchema = z.object({
  Id: z.number().int().positive(),
  Name: optionalText,
  Contact: z.object({ IdentificationNumber: optionalText }).nullable().optional(),
});

type IdokladDocument = z.infer<typeof documentSchema>;

// ---------------------------------------------------------------------------------------
// Document kinds
// ---------------------------------------------------------------------------------------

interface DocumentType {
  kind: InvoiceKind;
  /** Prefix of our external id: ids of the three lists are independent of each other. */
  prefix: string;
  /** List and detail endpoint. */
  path: string;
  /** `DocumentType` of its payments in IssuedDocumentPayments. */
  paymentDocumentType: number;
  /** Name in the Reports endpoints (`/Reports/{name}/{id}/Pdf`). */
  report: string;
}

/**
 * The documents Bystro tracks, in the order they are listed. Tax documents for received
 * payments (IssuedTaxDocuments) are not receivables and are left out, as with Fakturoid.
 */
const DOCUMENT_TYPES: readonly DocumentType[] = [
  {
    kind: "invoice",
    prefix: "invoice",
    path: "/IssuedInvoices",
    paymentDocumentType: 0,
    report: "IssuedInvoice",
  },
  {
    kind: "proforma",
    prefix: "proforma",
    path: "/ProformaInvoices",
    paymentDocumentType: 1,
    report: "ProformaInvoice",
  },
  {
    kind: "credit_note",
    prefix: "credit",
    path: "/CreditNotes",
    paymentDocumentType: 3,
    report: "CreditNote",
  },
];

const typeByPrefix = (prefix: string) => DOCUMENT_TYPES.find((type) => type.prefix === prefix);

const EXTERNAL_ID = /^([a-z]+)-([1-9]\d{0,17})$/;

/** Splits `invoice-123` into its document type and iDoklad id; `null` for anything else. */
function parseExternalId(externalId: string): { type: DocumentType; id: string } | null {
  const match = EXTERNAL_ID.exec(externalId);
  const type = match?.[1] === undefined ? undefined : typeByPrefix(match[1]);
  return type === undefined || match?.[2] === undefined ? null : { type, id: match[2] };
}

/**
 * `PaymentStatus`: Unpaid = 0, Paid = 1, PartialPaid = 2, Overpaid = 3. iDoklad has neither
 * drafts nor cancelled documents (a document is corrected by a credit note). A partial
 * payment leaves the invoice open; the remaining amount follows from its payments.
 */
const SOURCE_STATUSES: Readonly<Record<number, InvoiceSourceStatus>> = {
  0: "open",
  1: "paid",
  2: "open",
  3: "paid",
};

// ---------------------------------------------------------------------------------------
// Lists (currencies, countries)
// ---------------------------------------------------------------------------------------

const LISTS_TTL_MS = 24 * 60 * 60 * 1000;
/** Safety stop for a list that keeps returning a next page. */
const MAX_LIST_PAGES = 20;

/**
 * ISO 3166-1 alpha-3 → alpha-2 for the countries Czech companies usually invoice. iDoklad
 * gives alpha-3 and our model keeps alpha-2; a country missing here is stored as unknown.
 */
const COUNTRY_ALPHA2: Readonly<Record<string, string>> = {
  AUT: "AT",
  BEL: "BE",
  BGR: "BG",
  CHE: "CH",
  CYP: "CY",
  CZE: "CZ",
  DEU: "DE",
  DNK: "DK",
  ESP: "ES",
  EST: "EE",
  FIN: "FI",
  FRA: "FR",
  GBR: "GB",
  GRC: "GR",
  HRV: "HR",
  HUN: "HU",
  IRL: "IE",
  ITA: "IT",
  LTU: "LT",
  LUX: "LU",
  LVA: "LV",
  MLT: "MT",
  NLD: "NL",
  NOR: "NO",
  POL: "PL",
  PRT: "PT",
  ROU: "RO",
  SVK: "SK",
  SVN: "SI",
  SWE: "SE",
  UKR: "UA",
  USA: "US",
};

export interface IdokladListValues {
  /** Currency id → ISO 4217 code. */
  currencies: ReadonlyMap<number, string>;
  /** Country id → ISO 3166-1 alpha-2 code. */
  countries: ReadonlyMap<number, string>;
}

/**
 * iDoklad refers to currencies and countries by ids from its own lists. The lists are the
 * same for every account and hardly ever change, so they are fetched once and kept for a
 * day: one instance is meant to be shared by all connections of a process, which keeps
 * requests (counted against the account's monthly allowance) to a minimum.
 */
export class IdokladLists {
  private cached: { values: Promise<IdokladListValues>; loadedAt: number } | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  get(client: IdokladClient): Promise<IdokladListValues> {
    const current = this.cached;
    if (current !== null && this.now() - current.loadedAt < LISTS_TTL_MS) {
      return current.values;
    }
    const values = this.load(client);
    const entry = { values, loadedAt: this.now() };
    this.cached = entry;
    // A failed load is not kept: the next call tries again.
    values.catch(() => {
      if (this.cached === entry) this.cached = null;
    });
    return values;
  }

  private async load(client: IdokladClient): Promise<IdokladListValues> {
    const [currencies, countries] = await Promise.all([
      listAll(client, "/Currencies"),
      listAll(client, "/Countries"),
    ]);
    return strict(() => ({
      currencies: new Map(
        currencies.map((raw) => {
          const currency = currencySchema.parse(raw);
          return [currency.Id, currency.Code.trim().toUpperCase()] as const;
        }),
      ),
      countries: new Map(
        countries.flatMap((raw) => {
          const country = countrySchema.parse(raw);
          const alpha2 = COUNTRY_ALPHA2[country.Code.trim().toUpperCase()];
          return alpha2 === undefined ? [] : [[country.Id, alpha2] as const];
        }),
      ),
    }));
  }
}

async function listAll(client: IdokladClient, path: string): Promise<unknown[]> {
  const items: unknown[] = [];
  for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
    const data = await client.getData(path, {
      page: String(page),
      pagesize: String(IDOKLAD_PAGE_SIZE),
    });
    const parsed = strict(() => pageSchema.parse(data));
    items.push(...parsed.Items);
    if (page >= parsed.TotalPages) break;
  }
  return items;
}

// ---------------------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------------------

/** Runs a mapping step; anything not matching the documentation becomes `invalid_response`. */
function strict<T>(map: () => T): T {
  try {
    return map();
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("invalid_response");
  }
}

/** Like {@link strict} for fields we can live without: a value we cannot keep is `null`. */
function lenient<T>(map: () => T): T | null {
  try {
    return map();
  } catch {
    return null;
  }
}

const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

/**
 * The exact decimal text of an amount. JSON numbers arrive as doubles; printing a double
 * gives back the shortest decimal that identifies it, which is the number iDoklad wrote for
 * anything up to 15 significant digits. No arithmetic is done on the double. Larger values
 * (which would no longer be exact) and exponent forms are refused by the decimal parser.
 */
function decimalText(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e13) {
    throw new ProviderError("invalid_response");
  }
  return String(value);
}

const money = (value: number): bigint => parseMoneyToMinor(decimalText(value));

/** iDoklad's times are UTC and usually come without a zone designator. */
function toInstant(value: string | null | undefined): Date | null {
  const trimmed = text(value);
  if (trimmed === null) return null;
  const date = new Date(/(Z|[+-]\d{2}:\d{2})$/.test(trimmed) ? trimmed : `${trimmed}Z`);
  if (Number.isNaN(date.getTime())) throw new ProviderError("invalid_response");
  return date;
}

/**
 * A calendar day. A value without time, or at midnight, is that day; a value with another
 * time is a moment in UTC and gives the day it is in Europe/Prague.
 */
function toDay(value: string): DateOnly {
  const day = value.slice(0, 10);
  const time = value.slice(11);
  if (time === "" || /^00:00(:00(\.0+)?)?(Z|[+-]00:00)?$/.test(time)) {
    return day as DateOnly;
  }
  return todayInPrague(toInstant(value) as Date);
}

/** Accepts only what our model and database accept: 1–10 digits. */
const variableSymbol = (value: string | null | undefined): string | null => {
  const trimmed = text(value);
  return trimmed !== null && /^\d{1,10}$/.test(trimmed) ? trimmed : null;
};

function currencyCode(lists: IdokladListValues, currencyId: number): string {
  const code = lists.currencies.get(currencyId);
  if (code === undefined || !/^[A-Z]{3}$/.test(code)) {
    throw new ProviderError("invalid_response");
  }
  return code;
}

/** `PriceType`: WithVat = 0, WithoutVat = 1, OnlyBase = 2. */
const PRICE_WITH_VAT = 0;

function toLine(
  externalId: string,
  item: NonNullable<IdokladDocument["Items"]>[number],
  index: number,
): InvoiceLine {
  const vatRate = item.VatRate ?? null;
  const unitPrice = item.Prices.UnitPrice ?? null;
  // Our unit price is without VAT. A price entered with VAT is kept only when the rate is
  // zero (then both are the same); it is never recomputed here.
  const unitPriceIsNet = item.PriceType !== PRICE_WITH_VAT || vatRate === 0;
  return {
    externalId:
      item.Id === null || item.Id === undefined ? `${externalId}#${index + 1}` : String(item.Id),
    position: index + 1,
    description: item.Name ?? "",
    quantityMilli:
      item.Amount === null || item.Amount === undefined
        ? null
        : lenient(() => parseScaledSafeInteger(decimalText(item.Amount as number), 3)),
    unit: text(item.Unit),
    unitPriceMinor: unitPrice === null || !unitPriceIsNet ? null : lenient(() => money(unitPrice)),
    vatRateBasisPoints:
      vatRate === null ? null : lenient(() => parseScaledSafeInteger(decimalText(vatRate), 2)),
    totalMinor: money(item.Prices.TotalWithVat),
  };
}

function mapDocument(type: DocumentType, raw: unknown, lists: IdokladListValues): Invoice {
  return strict(() => {
    const document = documentSchema.parse(raw);
    const sourceStatus = SOURCE_STATUSES[document.PaymentStatus];
    if (sourceStatus === undefined) {
      throw new ProviderError("invalid_response");
    }
    const externalId = `${type.prefix}-${document.Id}`;
    const paidMinor = money(document.Prices.TotalPaid);
    const partnerId = document.PartnerId ?? null;
    return {
      source: IDOKLAD_SOURCE,
      externalId,
      sourceUpdatedAt: toInstant(document.Metadata?.DateLastChange),
      number: document.DocumentNumber,
      variableSymbol: variableSymbol(document.VariableSymbol),
      kind: type.kind,
      // The three lists contain only documents the account issues.
      direction: "issued",
      sourceStatus,
      clientExternalId: partnerId === null || partnerId <= 0 ? null : String(partnerId),
      issuedOn: toDay(document.DateOfIssue),
      taxableSupplyOn:
        document.DateOfTaxing === null || document.DateOfTaxing === undefined
          ? null
          : toDay(document.DateOfTaxing),
      dueOn: toDay(document.DateOfMaturity),
      // Only for a paid document: the field is not documented as empty for unpaid ones.
      paidOn:
        sourceStatus === "paid" &&
        document.DateOfPayment !== null &&
        document.DateOfPayment !== undefined
          ? toDay(document.DateOfPayment)
          : null,
      currency: currencyCode(lists, document.CurrencyId),
      subtotalMinor: money(document.Prices.TotalWithoutVat),
      vatMinor: money(document.Prices.TotalVat),
      totalMinor: money(document.Prices.TotalWithVat),
      lines: (document.Items ?? []).map((item, index) => toLine(externalId, item, index)),
      // Payments have their own endpoint. An unpaid document with nothing paid has none,
      // which saves the request; otherwise they are fetched with `listPayments`.
      payments: document.PaymentStatus === 0 && paidMinor === 0n ? [] : null,
    };
  });
}

/** Maps one issued invoice (GET /IssuedInvoices). */
export function mapIdokladInvoice(raw: unknown, lists: IdokladListValues): Invoice {
  return mapDocument(DOCUMENT_TYPES[0] as DocumentType, raw, lists);
}

/** Maps one proforma invoice (GET /ProformaInvoices). */
export function mapIdokladProforma(raw: unknown, lists: IdokladListValues): Invoice {
  return mapDocument(DOCUMENT_TYPES[1] as DocumentType, raw, lists);
}

/** Maps one credit note (GET /CreditNotes). */
export function mapIdokladCreditNote(raw: unknown, lists: IdokladListValues): Invoice {
  return mapDocument(DOCUMENT_TYPES[2] as DocumentType, raw, lists);
}

/**
 * Maps one payment (GET /IssuedDocumentPayments); `null` when it belongs to a document
 * Bystro does not track (e.g. a sales receipt).
 */
export function mapIdokladPayment(raw: unknown, lists: IdokladListValues): InvoicePayment | null {
  return strict(() => {
    const payment = paymentSchema.parse(raw);
    const type = DOCUMENT_TYPES.find(
      (candidate) => candidate.paymentDocumentType === payment.DocumentType,
    );
    if (type === undefined) {
      return null;
    }
    return {
      source: IDOKLAD_SOURCE,
      externalId: String(payment.Id),
      sourceUpdatedAt: toInstant(payment.Metadata?.DateLastChange),
      invoiceExternalId: `${type.prefix}-${payment.InvoiceId}`,
      paidOn: toDay(payment.DateOfPayment),
      amountMinor: money(payment.Prices.PaymentAmount),
      currency: currencyCode(lists, payment.CurrencyId),
    };
  });
}

export function mapIdokladContact(raw: unknown, lists: IdokladListValues): Client {
  return strict(() => {
    const contact = contactSchema.parse(raw);
    const person = [text(contact.Firstname), text(contact.Surname)]
      .filter((part) => part !== null)
      .join(" ");
    return {
      source: IDOKLAD_SOURCE,
      externalId: String(contact.Id),
      sourceUpdatedAt: toInstant(contact.Metadata?.DateLastChange),
      name: text(contact.CompanyName) ?? text(person) ?? `Kontakt ${contact.Id}`,
      ico: text(contact.IdentificationNumber),
      dic: text(contact.VatIdentificationNumber),
      street: text(contact.Street),
      city: text(contact.City),
      postalCode: text(contact.PostalCode),
      country:
        contact.CountryId === null || contact.CountryId === undefined
          ? null
          : (lists.countries.get(contact.CountryId) ?? null),
      email: text(contact.Email),
      phone: text(contact.Phone) ?? text(contact.Mobile),
    };
  });
}

// ---------------------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------------------

export interface IdokladAgenda {
  /** Id of the agenda (the company's account at iDoklad) the token belongs to. */
  id: string;
  name: string | null;
  registrationNo: string | null;
}

/**
 * The agenda the token was issued for (GET /Account/CurrentAgenda). At iDoklad the user
 * picks the agenda while signing in, so there is nothing to choose afterwards.
 */
export async function getIdokladAgenda(client: IdokladClient): Promise<IdokladAgenda> {
  const data = await client.getData("/Account/CurrentAgenda");
  return strict(() => {
    const agenda = agendaSchema.parse(data);
    return {
      id: String(agenda.Id),
      name: text(agenda.Name),
      registrationNo: text(agenda.Contact?.IdentificationNumber),
    };
  });
}

// ---------------------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------------------

/** Filter values are UTC without a zone designator: `2024-09-01T00:00:00.000`. */
const filterTime = (moment: Date) => moment.toISOString().slice(0, 23);

const pageNumber = (value: string | undefined): number | null =>
  value !== undefined && /^[1-9]\d{0,5}$/.test(value) ? Number(value) : null;

/** Cursor of the document lists: `<prefix>:<page>`, starting with the first list. */
function documentCursor(cursor: string | null | undefined): { index: number; page: number } {
  if (cursor === null || cursor === undefined) return { index: 0, page: 1 };
  const [prefix, pageText, ...rest] = cursor.split(":");
  const index = DOCUMENT_TYPES.findIndex((type) => type.prefix === prefix);
  const page = pageNumber(pageText);
  if (index < 0 || page === null || rest.length > 0) {
    throw new RangeError("Invalid iDoklad cursor.");
  }
  return { index, page };
}

function simpleCursor(cursor: string | null | undefined): number {
  if (cursor === null || cursor === undefined) return 1;
  const page = pageNumber(cursor);
  if (page === null) {
    throw new RangeError("Invalid iDoklad cursor.");
  }
  return page;
}

export class IdokladProvider implements InvoiceProvider {
  readonly source = IDOKLAD_SOURCE;

  constructor(
    private readonly client: IdokladClient,
    private readonly lists: IdokladLists,
  ) {}

  /** One page of a list, as documented: `page`, `pagesize`, `filter`, default sort by id. */
  private async page(path: string, page: number, filter: string | null) {
    const query: Record<string, string> = {
      page: String(page),
      pagesize: String(IDOKLAD_PAGE_SIZE),
    };
    if (filter !== null) {
      query.filter = `(${filter})`;
    }
    const data = await this.client.getData(path, query);
    const parsed = strict(() => pageSchema.parse(data));
    return { items: parsed.Items, hasNext: page < parsed.TotalPages };
  }

  /**
   * Issued invoices, then proforma invoices, then credit notes: three lists behind one
   * cursor. `updatedSince` filters by `DateLastChange`; `createdSince` by `DateOfIssue`,
   * the closest filterable column (the creation time is not one).
   */
  async listInvoices(options: ListOptions = {}): Promise<Page<Invoice>> {
    const { index, page } = documentCursor(options.cursor);
    const type = DOCUMENT_TYPES[index] as DocumentType;
    const conditions: string[] = [];
    if (options.updatedSince !== undefined) {
      conditions.push(`DateLastChange~gte~${filterTime(options.updatedSince)}`);
    }
    if (options.createdSince !== undefined) {
      conditions.push(`DateOfIssue~gte~${filterTime(options.createdSince)}`);
    }
    const lists = await this.lists.get(this.client);
    const { items, hasNext } = await this.page(
      type.path,
      page,
      conditions.length === 0 ? null : conditions.join("~and~"),
    );
    const next = DOCUMENT_TYPES[index + 1];
    return {
      items: items.map((raw) => mapDocument(type, raw, lists)),
      nextCursor: hasNext
        ? `${type.prefix}:${page + 1}`
        : next === undefined
          ? null
          : `${next.prefix}:1`,
    };
  }

  async getInvoice(externalId: string): Promise<Invoice | null> {
    const parsed = parseExternalId(externalId);
    if (parsed === null) return null;
    const data = await this.client.getData(
      `${parsed.type.path}/${parsed.id}`,
      {},
      { allowNotFound: true },
    );
    if (data === null) return null;
    return mapDocument(parsed.type, data, await this.lists.get(this.client));
  }

  async listClients(options: ListOptions = {}): Promise<Page<Client>> {
    const page = simpleCursor(options.cursor);
    const lists = await this.lists.get(this.client);
    const { items, hasNext } = await this.page(
      "/Contacts",
      page,
      options.updatedSince === undefined
        ? null
        : `DateLastChange~gte~${filterTime(options.updatedSince)}`,
    );
    return {
      items: items.map((raw) => mapIdokladContact(raw, lists)),
      nextCursor: hasNext ? String(page + 1) : null,
    };
  }

  /**
   * Payments of issued documents. With `invoiceExternalIds` only the payments of those
   * documents (the filter is by `InvoiceId`, which is shared by the three document lists,
   * so the result is narrowed again by document type). Payments cannot be filtered by when
   * they changed: `updatedSince` is ignored, and `createdSince` filters by payment date.
   */
  async listPayments(options: ListOptions = {}): Promise<Page<InvoicePayment>> {
    const page = simpleCursor(options.cursor);
    const wanted = options.invoiceExternalIds;
    let filter: string | null = null;
    if (wanted !== undefined) {
      const ids = new Set(
        wanted
          .map((externalId) => parseExternalId(externalId)?.id)
          .filter((id) => id !== undefined),
      );
      if (ids.size === 0) {
        return { items: [], nextCursor: null };
      }
      filter = [...ids].map((id) => `InvoiceId~eq~${id}`).join("~or~");
    } else if (options.createdSince !== undefined) {
      filter = `DateOfPayment~gte~${filterTime(options.createdSince)}`;
    }
    const lists = await this.lists.get(this.client);
    const { items, hasNext } = await this.page("/IssuedDocumentPayments", page, filter);
    const payments = items
      .map((raw) => mapIdokladPayment(raw, lists))
      .filter((payment) => payment !== null)
      .filter((payment) => wanted === undefined || wanted.includes(payment.invoiceExternalId));
    return { items: payments, nextCursor: hasNext ? String(page + 1) : null };
  }

  /** The printed document: the Reports endpoint returns the PDF as Base64 text in `Data`. */
  async getDocument(invoiceExternalId: string): Promise<InvoiceDocument | null> {
    const parsed = parseExternalId(invoiceExternalId);
    if (parsed === null) return null;
    const data = await this.client.getData(
      `/Reports/${parsed.type.report}/${parsed.id}/Pdf`,
      {},
      { allowNotFound: true },
    );
    if (data === null) return null;
    const content = strict(
      () => new Uint8Array(Buffer.from(z.string().min(1).parse(data), "base64")),
    );
    // "%PDF": anything else is not what the documentation promises.
    if (content.length < 4 || Buffer.from(content.subarray(0, 4)).toString("latin1") !== "%PDF") {
      throw new ProviderError("invalid_response");
    }
    return {
      fileName: `${invoiceExternalId}.pdf`,
      contentType: "application/pdf",
      content,
    };
  }
}

import {
  parseMoneyToMinor,
  parseScaledSafeInteger,
  ProviderError,
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
import { FAKTUROID_API_BASE_URL, FAKTUROID_PAGE_SIZE, type FakturoidClient } from "./client";

/**
 * Fakturoid as an {@link InvoiceProvider}. Documentation (read 2026-10-11):
 * - Invoices (list, detail, PDF): https://www.fakturoid.cz/api/v3/invoices
 * - Subjects (clients): https://www.fakturoid.cz/api/v3/subjects
 * - Invoice payments (embedded in invoices; no list endpoint): https://www.fakturoid.cz/api/v3/invoice-payments
 * - Current user and accounts: https://www.fakturoid.cz/api/v3/users
 *
 * Read-only: nothing here writes to Fakturoid. Everything Fakturoid returns is external,
 * untrusted text and is validated before use.
 */
export const FAKTUROID_SOURCE = "fakturoid";

// ---------------------------------------------------------------------------------------
// OAuth (https://www.fakturoid.cz/api/v3/authorization)
// ---------------------------------------------------------------------------------------

export const FAKTUROID_AUTHORIZATION_ENDPOINT = `${FAKTUROID_API_BASE_URL}/oauth`;
export const FAKTUROID_TOKEN_ENDPOINT = `${FAKTUROID_API_BASE_URL}/oauth/token`;
/** Revokes the refresh token and with it the access token (used on disconnect, step 2.6). */
export const FAKTUROID_REVOKE_ENDPOINT = `${FAKTUROID_API_BASE_URL}/oauth/revoke`;

/**
 * Authorization Code flow as documented: client authentication by HTTP Basic, no scopes
 * and no PKCE (neither is mentioned in the documentation). Access tokens live 2 hours;
 * refresh tokens do not expire and are not returned again on refresh.
 */
export function fakturoidOAuthConfig(input: {
  clientId: string;
  clientSecret: Secret;
  userAgent: string;
}): OAuthProviderConfig {
  return {
    id: FAKTUROID_SOURCE,
    authorizationEndpoint: FAKTUROID_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: FAKTUROID_TOKEN_ENDPOINT,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    scopes: [],
    pkce: "none",
    clientAuthentication: "basic",
    tokenRequestHeaders: { "User-Agent": input.userAgent },
  };
}

// ---------------------------------------------------------------------------------------
// Response shapes: only the fields we use. Fakturoid sends many more.
// ---------------------------------------------------------------------------------------

const decimal = z.string();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalText = z.string().nullable().optional();

const lineSchema = z.object({
  id: z.number().int().nullable().optional(),
  name: z.string(),
  quantity: decimal,
  unit_name: optionalText,
  unit_price_without_vat: decimal,
  vat_rate: z.union([z.number(), z.string()]),
  total_price_without_vat: decimal,
  total_vat: decimal,
});

const paymentSchema = z.object({
  id: z.number().int(),
  paid_on: isoDate,
  currency: z.string(),
  amount: decimal,
  updated_at: z.string().nullable().optional(),
});

const invoiceSchema = z.object({
  id: z.number().int(),
  number: z.string(),
  variable_symbol: optionalText,
  document_type: z.string(),
  status: z.string(),
  subject_id: z.number().int().nullable(),
  issued_on: isoDate,
  taxable_fulfillment_due: optionalText,
  due_on: isoDate,
  paid_on: isoDate.nullable().optional(),
  currency: z.string(),
  subtotal: decimal,
  total: decimal,
  lines: z.array(lineSchema),
  payments: z.array(paymentSchema).default([]),
  updated_at: z.string(),
});

const subjectSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  registration_no: optionalText,
  vat_no: optionalText,
  street: optionalText,
  city: optionalText,
  zip: optionalText,
  country: optionalText,
  email: optionalText,
  phone: optionalText,
  updated_at: z.string().nullable().optional(),
});

const userSchema = z.object({
  accounts: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      registration_no: optionalText,
      permission: z.string(),
      allowed_scope: z.array(z.string()).default([]),
    }),
  ),
});

type FakturoidInvoice = z.infer<typeof invoiceSchema>;
type FakturoidSubject = z.infer<typeof subjectSchema>;

// ---------------------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------------------

/**
 * Document types (https://www.fakturoid.cz/api/v3/invoices#document-type). `tax_document`
 * (daňový doklad k přijaté platbě) is not a receivable: the money was already paid on a
 * proforma, so it is skipped (`null`).
 */
const DOCUMENT_KINDS: Readonly<Record<string, InvoiceKind | null>> = {
  invoice: "invoice",
  final_invoice: "invoice",
  proforma: "proforma",
  partial_proforma: "proforma",
  correction: "credit_note",
  tax_document: null,
};

/**
 * Statuses (https://www.fakturoid.cz/api/v3/invoices#invoice-status-table). Fakturoid has
 * no drafts. `uncollectible` (nedobytná) is treated as cancelled: no income is expected
 * and there is nobody left to remind.
 */
const SOURCE_STATUSES: Readonly<Record<string, InvoiceSourceStatus>> = {
  open: "open",
  sent: "open",
  overdue: "open",
  paid: "paid",
  cancelled: "cancelled",
  uncollectible: "cancelled",
};

/** Runs a mapping step; anything not matching the documentation becomes `invalid_response`. */
function strict<T>(map: () => T): T {
  try {
    return map();
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("invalid_response");
  }
}

const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

const toDate = (value: string | null | undefined): Date | null => {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ProviderError("invalid_response");
  return date;
};

/** Accepts only what our model and database accept: 1–10 digits. */
const variableSymbol = (value: string | null | undefined): string | null => {
  const trimmed = text(value);
  return trimmed !== null && /^\d{1,10}$/.test(trimmed) ? trimmed : null;
};

const country = (value: string | null | undefined): string | null => {
  const trimmed = text(value)?.toUpperCase() ?? null;
  return trimmed !== null && /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
};

function toLine(invoiceId: number, line: FakturoidInvoice["lines"][number], index: number) {
  const totalWithoutVat = parseMoneyToMinor(line.total_price_without_vat);
  const mapped: InvoiceLine = {
    externalId:
      line.id === null || line.id === undefined ? `${invoiceId}#${index + 1}` : String(line.id),
    position: index + 1,
    description: line.name,
    quantityMilli: parseScaledSafeInteger(line.quantity, 3),
    unit: text(line.unit_name),
    unitPriceMinor: parseMoneyToMinor(line.unit_price_without_vat),
    vatRateBasisPoints: parseScaledSafeInteger(String(line.vat_rate), 2),
    totalMinor: totalWithoutVat + parseMoneyToMinor(line.total_vat),
  };
  return mapped;
}

function toPayment(
  invoiceId: number,
  payment: FakturoidInvoice["payments"][number],
): InvoicePayment {
  return {
    source: FAKTUROID_SOURCE,
    externalId: String(payment.id),
    sourceUpdatedAt: toDate(payment.updated_at),
    invoiceExternalId: String(invoiceId),
    paidOn: payment.paid_on as DateOnly,
    amountMinor: parseMoneyToMinor(payment.amount),
    currency: payment.currency.toUpperCase(),
  };
}

/** Maps one invoice; `null` for documents Bystro does not track (see {@link DOCUMENT_KINDS}). */
export function mapFakturoidInvoice(raw: unknown): Invoice | null {
  return strict(() => {
    const invoice = invoiceSchema.parse(raw);
    const kind = DOCUMENT_KINDS[invoice.document_type];
    const sourceStatus = SOURCE_STATUSES[invoice.status];
    if (kind === undefined || sourceStatus === undefined) {
      throw new ProviderError("invalid_response");
    }
    if (kind === null) {
      return null;
    }
    const subtotalMinor = parseMoneyToMinor(invoice.subtotal);
    const totalMinor = parseMoneyToMinor(invoice.total);
    const taxableSupplyOn = text(invoice.taxable_fulfillment_due);
    if (taxableSupplyOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(taxableSupplyOn)) {
      throw new ProviderError("invalid_response");
    }
    return {
      source: FAKTUROID_SOURCE,
      externalId: String(invoice.id),
      sourceUpdatedAt: toDate(invoice.updated_at),
      number: invoice.number,
      variableSymbol: variableSymbol(invoice.variable_symbol),
      kind,
      // The invoices endpoint lists only documents the account issues.
      direction: "issued",
      sourceStatus,
      clientExternalId: invoice.subject_id === null ? null : String(invoice.subject_id),
      issuedOn: invoice.issued_on as DateOnly,
      taxableSupplyOn: taxableSupplyOn as DateOnly | null,
      dueOn: invoice.due_on as DateOnly,
      paidOn: (invoice.paid_on ?? null) as DateOnly | null,
      currency: invoice.currency.toUpperCase(),
      subtotalMinor,
      // There is no VAT total in the response; per line and per rate it adds up to this.
      vatMinor: totalMinor - subtotalMinor,
      totalMinor,
      lines: invoice.lines.map((line, index) => toLine(invoice.id, line, index)),
      // Fakturoid sends an invoice's payments inside it, so no second request is needed.
      payments: invoice.payments.map((payment) => toPayment(invoice.id, payment)),
    };
  });
}

/** Payments recorded on an invoice Bystro tracks. */
export function mapFakturoidPayments(raw: unknown): InvoicePayment[] {
  return strict(() => {
    const invoice = invoiceSchema.parse(raw);
    // Payments of documents Bystro does not track would point at nothing.
    if (DOCUMENT_KINDS[invoice.document_type] === null) {
      return [];
    }
    return invoice.payments.map((payment) => toPayment(invoice.id, payment));
  });
}

export function mapFakturoidSubject(raw: unknown): Client {
  return strict(() => {
    const subject: FakturoidSubject = subjectSchema.parse(raw);
    return {
      source: FAKTUROID_SOURCE,
      externalId: String(subject.id),
      sourceUpdatedAt: toDate(subject.updated_at),
      name: subject.name,
      ico: text(subject.registration_no),
      dic: text(subject.vat_no),
      street: text(subject.street),
      city: text(subject.city),
      postalCode: text(subject.zip),
      country: country(subject.country),
      email: text(subject.email),
      phone: text(subject.phone),
    };
  });
}

// ---------------------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------------------

export interface FakturoidAccount {
  slug: string;
  name: string;
  registrationNo: string | null;
  /** The signed-in user's role in the account, e.g. `owner`. */
  permission: string;
  /** Parts of the account the user may access: `invoices`, `expenses`, `reports`. */
  allowedScope: string[];
}

/** Accounts the token's user can open (GET /user.json), to choose one after connecting. */
export async function listFakturoidAccounts(client: FakturoidClient): Promise<FakturoidAccount[]> {
  const body = await client.getJson("/user.json");
  return strict(() =>
    userSchema.parse(body).accounts.map((account) => ({
      slug: account.slug,
      name: account.name,
      registrationNo: text(account.registration_no),
      permission: account.permission,
      allowedScope: account.allowed_scope,
    })),
  );
}

const SLUG = /^[a-z0-9_-]+$/i;
const NUMERIC_ID = /^\d+$/;

function pageFromCursor(cursor: string | null | undefined): number {
  if (cursor === null || cursor === undefined) return 1;
  if (!/^[1-9]\d{0,5}$/.test(cursor)) {
    throw new RangeError("Invalid Fakturoid cursor.");
  }
  return Number(cursor);
}

export class FakturoidProvider implements InvoiceProvider {
  readonly source = FAKTUROID_SOURCE;
  private readonly accountPath: string;

  constructor(
    private readonly client: FakturoidClient,
    slug: string,
  ) {
    if (!SLUG.test(slug)) {
      throw new RangeError("Invalid Fakturoid account slug.");
    }
    this.accountPath = `/accounts/${slug}`;
  }

  /** One page of a collection; the cursor is the next page number. */
  private async page(path: string, options: ListOptions): Promise<Page<unknown>> {
    const page = pageFromCursor(options.cursor);
    const query: Record<string, string> = { page: String(page) };
    if (options.updatedSince !== undefined) {
      query.updated_since = options.updatedSince.toISOString();
    }
    if (options.createdSince !== undefined) {
      query.since = options.createdSince.toISOString();
    }
    const body = await this.client.getJson(`${this.accountPath}${path}`, query);
    const items = strict(() => z.array(z.unknown()).parse(body));
    return {
      items,
      nextCursor: items.length >= FAKTUROID_PAGE_SIZE ? String(page + 1) : null,
    };
  }

  async listInvoices(options: ListOptions = {}): Promise<Page<Invoice>> {
    const { items, nextCursor } = await this.page("/invoices.json", options);
    const invoices = items.map(mapFakturoidInvoice).filter((invoice) => invoice !== null);
    return { items: invoices, nextCursor };
  }

  async getInvoice(externalId: string): Promise<Invoice | null> {
    if (!NUMERIC_ID.test(externalId)) return null;
    const body = await this.client.getJson(
      `${this.accountPath}/invoices/${externalId}.json`,
      {},
      { allowNotFound: true },
    );
    return body === null ? null : mapFakturoidInvoice(body);
  }

  async listClients(options: ListOptions = {}): Promise<Page<Client>> {
    const { items, nextCursor } = await this.page("/subjects.json", options);
    return { items: items.map(mapFakturoidSubject), nextCursor };
  }

  /**
   * Fakturoid has no endpoint listing payments; they come inside invoices. This pages
   * through invoices (with the same cursor and `updatedSince`) and returns their payments.
   */
  async listPayments(options: ListOptions = {}): Promise<Page<InvoicePayment>> {
    const { items, nextCursor } = await this.page("/invoices.json", options);
    return { items: items.flatMap(mapFakturoidPayments), nextCursor };
  }

  async getDocument(invoiceExternalId: string): Promise<InvoiceDocument | null> {
    if (!NUMERIC_ID.test(invoiceExternalId)) return null;
    const pdf = await this.client.getPdf(
      `${this.accountPath}/invoices/${invoiceExternalId}/download.pdf`,
    );
    if (pdf === null) return null;
    return {
      fileName: `faktura-${invoiceExternalId}.pdf`,
      contentType: pdf.contentType,
      content: pdf.content,
    };
  }
}

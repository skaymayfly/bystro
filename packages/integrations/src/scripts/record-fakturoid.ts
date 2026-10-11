import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadRootEnv } from "@bystro/db/testing";

import { FAKTUROID_API_BASE_URL, fakturoidUserAgent } from "../fakturoid/client";

/**
 * Records real Fakturoid responses from a TEST account as test fixtures.
 *
 *   pnpm --filter @bystro/integrations record:fakturoid
 *
 * Needs in the root `.env` (never commit them, never paste them anywhere):
 * - FAKTUROID_RECORD_CLIENT_ID, FAKTUROID_RECORD_CLIENT_SECRET: Client Credentials of your
 *   own Fakturoid user (Nastavení → Uživatelský účet), see
 *   https://www.fakturoid.cz/api/v3/authorization (Client Credentials Flow);
 * - INTEGRATIONS_CONTACT_EMAIL: contact for the required User-Agent header;
 * - FAKTUROID_RECORD_SLUG (optional): the account to record; default = the user's first.
 *
 * Read-only. Only an allow-list of fields is written, and everything that could identify a
 * person or a company (names, addresses, IČO, DIČ, e-mails, phones, item names, notes,
 * links) is replaced with made-up values. Amounts, dates, statuses and ids stay as they are.
 */

const OUTPUT_DIR = fileURLToPath(new URL("../fakturoid/fixtures/recorded/", import.meta.url));
const MAX_INVOICE_PAGES = 3;

type Json = Record<string, unknown>;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set in .env.`);
  }
  return value;
}

function pick(source: Json, keys: readonly string[]): Json {
  return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]));
}

const fakeDigits = (seed: number, length: number) =>
  String(seed * 7919)
    .padStart(length, "0")
    .slice(-length);

function anonymizeInvoice(invoice: Json): Json {
  const lines = Array.isArray(invoice.lines) ? (invoice.lines as Json[]) : [];
  const payments = Array.isArray(invoice.payments) ? (invoice.payments as Json[]) : [];
  return {
    ...pick(invoice, [
      "id",
      "number",
      "variable_symbol",
      "document_type",
      "status",
      "subject_id",
      "issued_on",
      "taxable_fulfillment_due",
      "due_on",
      "paid_on",
      "cancelled_at",
      "uncollectible_at",
      "currency",
      "subtotal",
      "total",
      "native_subtotal",
      "native_total",
      "remaining_amount",
      "created_at",
      "updated_at",
    ]),
    lines: lines.map((line, index) => ({
      ...pick(line, [
        "id",
        "quantity",
        "unit_name",
        "unit_price",
        "vat_rate",
        "unit_price_without_vat",
        "unit_price_with_vat",
        "total_price_without_vat",
        "total_vat",
      ]),
      name: `Položka ${index + 1}`,
    })),
    payments: payments.map((payment) =>
      pick(payment, ["id", "paid_on", "currency", "amount", "native_amount", "updated_at"]),
    ),
  };
}

function anonymizeSubject(subject: Json, index: number): Json {
  const seed = index + 1;
  return {
    ...pick(subject, ["id", "type", "country", "created_at", "updated_at"]),
    name: `Klient ${seed} s.r.o.`,
    registration_no: subject.registration_no ? fakeDigits(seed, 8) : subject.registration_no,
    vat_no: subject.vat_no ? `CZ${fakeDigits(seed, 8)}` : subject.vat_no,
    street: subject.street ? `Ulice ${seed}` : subject.street,
    city: subject.city ? "Praha" : subject.city,
    zip: subject.zip ? "11000" : subject.zip,
    email: subject.email ? `klient-${seed}@example.test` : subject.email,
    phone: subject.phone ? "+420 000 000 000" : subject.phone,
  };
}

function anonymizeUser(user: Json): Json {
  const accounts = Array.isArray(user.accounts) ? (user.accounts as Json[]) : [];
  return {
    accounts: accounts.map((account, index) => ({
      ...pick(account, ["permission", "allowed_scope"]),
      slug: `testovaci-ucet-${index + 1}`,
      name: `Testovací účet ${index + 1}`,
      registration_no: fakeDigits(index + 1, 8),
    })),
  };
}

async function main(): Promise<void> {
  loadRootEnv();
  const userAgent = fakturoidUserAgent(requireEnv("INTEGRATIONS_CONTACT_EMAIL"));
  const clientId = requireEnv("FAKTUROID_RECORD_CLIENT_ID");
  const clientSecret = requireEnv("FAKTUROID_RECORD_CLIENT_SECRET");

  const tokenResponse = await fetch(`${FAKTUROID_API_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      "User-Agent": userAgent,
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64url")}`,
    },
    body: JSON.stringify({ grant_type: "client_credentials" }),
  });
  if (!tokenResponse.ok) {
    throw new Error(`Fakturoid refused the credentials (HTTP ${tokenResponse.status}).`);
  }
  const { access_token: accessToken } = (await tokenResponse.json()) as { access_token: string };

  async function get(path: string): Promise<unknown> {
    const response = await fetch(`${FAKTUROID_API_BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": userAgent,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(
        `GET ${path.replace(/\/accounts\/[^/]+/, "/accounts/…")} → HTTP ${response.status}`,
      );
    }
    return response.json();
  }

  const user = (await get("/user.json")) as Json;
  const accounts = (user.accounts ?? []) as Json[];
  const slug = process.env.FAKTUROID_RECORD_SLUG?.trim() || String(accounts[0]?.slug ?? "");
  if (slug === "") {
    throw new Error("The user has no Fakturoid account.");
  }

  const invoices: Json[] = [];
  for (let page = 1; page <= MAX_INVOICE_PAGES; page += 1) {
    const batch = (await get(`/accounts/${slug}/invoices.json?page=${page}`)) as Json[];
    invoices.push(...batch);
    if (batch.length < 40) break;
  }
  const subjects = (await get(`/accounts/${slug}/subjects.json?page=1`)) as Json[];

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const write = (name: string, data: unknown) =>
    writeFileSync(`${OUTPUT_DIR}${name}`, `${JSON.stringify(data, null, 2)}\n`);
  write("user.json", anonymizeUser(user));
  write("invoices.json", invoices.map(anonymizeInvoice));
  write("subjects.json", subjects.map(anonymizeSubject));

  const types = [
    ...new Set(invoices.map((invoice) => `${invoice.document_type}/${invoice.status}`)),
  ];
  console.info(
    `Recorded ${invoices.length} invoices (${types.join(", ")}) and ${subjects.length} subjects into src/fakturoid/fixtures/recorded/. Check the files before committing them.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Recording failed.");
  process.exitCode = 1;
});

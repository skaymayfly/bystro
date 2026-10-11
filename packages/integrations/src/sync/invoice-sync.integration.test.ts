import { randomBytes } from "node:crypto";

import {
  Secret,
  type Client,
  type Invoice,
  type InvoicePayment,
  type InvoiceProvider,
  type ListOptions,
} from "@bystro/core";
import {
  countInvoiceLines,
  createDb,
  getSyncCursor,
  listCompanies,
  listInvoicePayments,
  listInvoices,
  saveConnection,
  type SyncScope,
} from "@bystro/db";
import { createTestOrganization, readTestDatabase } from "@bystro/db/testing";
import { afterAll, describe, expect, it } from "vitest";

import { syncInvoices, withRequestHook } from "./invoice-sync";

const { db, close } = createDb(readTestDatabase().url);

afterAll(async () => {
  await close();
});

const SOURCE = "testprovider";
const NOW = new Date("2026-10-11T08:00:00Z");

/** An invoicing system held in memory: tests change its data between syncs. */
class InMemoryProvider implements InvoiceProvider {
  readonly source = SOURCE;
  clients: Client[] = [];
  invoices: Invoice[] = [];
  /** Payments of invoices that do not carry them (`payments: null`). */
  payments: InvoicePayment[] = [];
  readonly calls: { method: string; options?: ListOptions; id?: string }[] = [];
  pageSize = 2;

  private page<T>(items: T[], cursor: string | null | undefined) {
    const start = cursor ? Number(cursor) : 0;
    const end = start + this.pageSize;
    return { items: items.slice(start, end), nextCursor: end < items.length ? String(end) : null };
  }

  async listInvoices(options: ListOptions = {}) {
    this.calls.push({ method: "listInvoices", options });
    const { updatedSince, createdSince } = options;
    const matching = this.invoices.filter(
      (invoice) =>
        (updatedSince === undefined || (invoice.sourceUpdatedAt ?? NOW) >= updatedSince) &&
        (createdSince === undefined || new Date(`${invoice.issuedOn}T12:00:00Z`) >= createdSince),
    );
    return this.page(matching, options.cursor);
  }

  async getInvoice(externalId: string) {
    this.calls.push({ method: "getInvoice", id: externalId });
    return this.invoices.find((invoice) => invoice.externalId === externalId) ?? null;
  }

  async listClients(options: ListOptions = {}) {
    this.calls.push({ method: "listClients", options });
    return this.page(this.clients, options.cursor);
  }

  async listPayments(options: ListOptions = {}) {
    this.calls.push({ method: "listPayments", options });
    const wanted = options.invoiceExternalIds;
    const matching = this.payments.filter(
      (payment) => wanted === undefined || wanted.includes(payment.invoiceExternalId),
    );
    return this.page(matching, options.cursor);
  }

  async getDocument() {
    return null;
  }
}

const client = (externalId: string, name = `Klient ${externalId}`): Client => ({
  source: SOURCE,
  externalId,
  sourceUpdatedAt: new Date("2026-09-01T10:00:00Z"),
  name,
  ico: "27074358",
  dic: null,
  street: null,
  city: "Praha",
  postalCode: null,
  country: "CZ",
  email: `${externalId}@example.test`,
  phone: null,
});

const payment = (
  externalId: string,
  invoiceExternalId: string,
  amountMinor: bigint,
): InvoicePayment => ({
  source: SOURCE,
  externalId,
  sourceUpdatedAt: null,
  invoiceExternalId,
  paidOn: "2026-10-05",
  amountMinor,
  currency: "CZK",
});

const invoice = (externalId: string, overrides: Partial<Invoice> = {}): Invoice => ({
  source: SOURCE,
  externalId,
  sourceUpdatedAt: new Date("2026-09-20T10:00:00Z"),
  number: `2026-${externalId}`,
  variableSymbol: null,
  kind: "invoice",
  direction: "issued",
  sourceStatus: "open",
  clientExternalId: "c1",
  issuedOn: "2026-09-20",
  taxableSupplyOn: null,
  dueOn: "2026-10-04",
  paidOn: null,
  currency: "CZK",
  subtotalMinor: 100_000n,
  vatMinor: 21_000n,
  totalMinor: 121_000n,
  lines: [
    {
      externalId: `${externalId}#1`,
      position: 1,
      description: "Práce",
      quantityMilli: 1_000,
      unit: "h",
      unitPriceMinor: 100_000n,
      vatRateBasisPoints: 2_100,
      totalMinor: 121_000n,
    },
  ],
  payments: [],
  ...overrides,
});

async function connected(name: string) {
  const { organization, owner } = await createTestOrganization(db, name);
  const connection = await saveConnection(
    db,
    organization.id,
    {
      provider: SOURCE,
      category: "invoicing",
      scopes: [],
      tokens: { accessToken: new Secret("token"), refreshToken: null, expiresAt: null },
      userId: owner.id,
      source: "web",
    },
    randomBytes(32),
  );
  const scope: SyncScope = { organizationId: organization.id, connectionId: connection.id };
  return { scope, organizationId: organization.id };
}

function seeded() {
  const provider = new InMemoryProvider();
  provider.clients = [client("c1"), client("c2")];
  provider.invoices = [
    invoice("1"),
    invoice("2", { clientExternalId: "c2", payments: [payment("p1", "2", 50_000n)] }),
    invoice("3", { sourceStatus: "paid", paidOn: "2026-10-01" }),
  ];
  return provider;
}

describe("syncInvoices", () => {
  it("the first sync loads clients, invoices, lines and payments", async () => {
    const { scope, organizationId } = await connected("Firma A");
    const provider = seeded();

    const result = await syncInvoices({ db, scope, provider, mode: "incremental", now: NOW });

    // A connection without a cursor always gets a full sync, limited to the last 12 months.
    expect(result).toEqual({
      mode: "full",
      clients: { created: 2, updated: 0, unchanged: 0 },
      invoices: { created: 3, updated: 0, unchanged: 0, deleted: 0 },
      payments: { created: 1, updated: 0, removed: 0 },
    });
    const listing = provider.calls.find((call) => call.method === "listInvoices");
    expect(listing?.options?.createdSince).toEqual(new Date("2025-10-11T08:00:00Z"));

    const stored = await listInvoices(db, organizationId);
    expect(stored.map((row) => row.externalId).sort()).toEqual(["1", "2", "3"]);
    const companies = await listCompanies(db, organizationId);
    const second = stored.find((row) => row.externalId === "2");
    expect(second?.companyId).toBe(companies.find((row) => row.externalId === "c2")?.id);
    expect(second).toMatchObject({ totalMinor: 121_000n, dueOn: "2026-10-04", currency: "CZK" });
    expect(await countInvoiceLines(db, organizationId, second?.id ?? "")).toBe(1);
    expect(await listInvoicePayments(db, organizationId)).toMatchObject([
      { externalId: "p1", amountMinor: 50_000n, invoiceId: second?.id },
    ]);
    expect(await getSyncCursor(db, organizationId, scope.connectionId, "invoices")).toBe(
      NOW.toISOString(),
    );
  });

  it("running it twice over the same data creates no duplicates", async () => {
    const { scope, organizationId } = await connected("Firma A");
    const provider = seeded();

    await syncInvoices({ db, scope, provider, mode: "full", now: NOW });
    const again = await syncInvoices({ db, scope, provider, mode: "full", now: NOW });

    expect(again).toMatchObject({
      clients: { created: 0, updated: 0, unchanged: 2 },
      invoices: { created: 0, updated: 0, unchanged: 3, deleted: 0 },
      payments: { created: 0, updated: 0, removed: 0 },
    });
    expect(await listInvoices(db, organizationId)).toHaveLength(3);
    expect(await listCompanies(db, organizationId)).toHaveLength(2);
    expect(await listInvoicePayments(db, organizationId)).toHaveLength(1);
  });

  it("an invoice deleted at the source is marked deleted, and comes back if restored", async () => {
    const { scope, organizationId } = await connected("Firma A");
    const provider = seeded();
    await syncInvoices({ db, scope, provider, mode: "full", now: NOW });

    const removed = provider.invoices.splice(0, 1);
    const result = await syncInvoices({ db, scope, provider, mode: "full", now: NOW });

    expect(result.invoices.deleted).toBe(1);
    expect((await listInvoices(db, organizationId)).map((row) => row.externalId).sort()).toEqual([
      "2",
      "3",
    ]);
    const all = await listInvoices(db, organizationId, { includeDeleted: true });
    expect(all.find((row) => row.externalId === "1")?.deletedAt).toBeInstanceOf(Date);
    // Each candidate was asked for by id before being marked.
    expect(provider.calls.filter((call) => call.method === "getInvoice")).toEqual([
      { method: "getInvoice", id: "1" },
    ]);

    provider.invoices.push(...removed);
    await syncInvoices({ db, scope, provider, mode: "full", now: NOW });
    expect(await listInvoices(db, organizationId)).toHaveLength(3);
    expect(await listInvoices(db, organizationId, { includeDeleted: true })).toHaveLength(3);
  });

  it("keeps an invoice the listing skipped but the source still has", async () => {
    const { scope, organizationId } = await connected("Firma A");
    const provider = seeded();
    await syncInvoices({ db, scope, provider, mode: "full", now: NOW });

    // Still at the source, just no longer returned by the list.
    const hidden = provider.invoices[0] as Invoice;
    const originalList = provider.listInvoices.bind(provider);
    provider.listInvoices = async (options) => {
      const page = await originalList(options);
      return { ...page, items: page.items.filter((item) => item.externalId !== hidden.externalId) };
    };

    const result = await syncInvoices({ db, scope, provider, mode: "full", now: NOW });
    expect(result.invoices.deleted).toBe(0);
    expect(await listInvoices(db, organizationId)).toHaveLength(3);
  });

  it("an incremental sync asks only for changes and applies them", async () => {
    const { scope, organizationId } = await connected("Firma A");
    const provider = seeded();
    await syncInvoices({ db, scope, provider, mode: "full", now: NOW });
    provider.calls.length = 0;

    const later = new Date("2026-10-11T09:00:00Z");
    // Nothing changed: one request, nothing written.
    const idle = await syncInvoices({ db, scope, provider, mode: "incremental", now: later });
    expect(idle.invoices).toEqual({ created: 0, updated: 0, unchanged: 0, deleted: 0 });
    expect(provider.calls).toEqual([
      {
        method: "listInvoices",
        options: { cursor: null, updatedSince: new Date("2026-10-11T07:55:00Z") },
      },
    ]);

    // Invoice 1 gets paid with two lines instead of one; invoice 2 loses its payment.
    const changedAt = new Date("2026-10-11T09:30:00Z");
    provider.invoices[0] = invoice("1", {
      sourceUpdatedAt: changedAt,
      sourceStatus: "paid",
      paidOn: "2026-10-11",
      lines: [
        {
          ...(invoice("1").lines[0] as Invoice["lines"][number]),
          externalId: "1#a",
          totalMinor: 60_500n,
        },
        {
          ...(invoice("1").lines[0] as Invoice["lines"][number]),
          externalId: "1#b",
          position: 2,
          totalMinor: 60_500n,
        },
      ],
      payments: [payment("p9", "1", 121_000n)],
    });
    provider.invoices[1] = invoice("2", {
      clientExternalId: "c2",
      sourceUpdatedAt: changedAt,
      payments: [],
    });

    const result = await syncInvoices({
      db,
      scope,
      provider,
      mode: "incremental",
      now: new Date("2026-10-11T10:00:00Z"),
    });
    expect(result).toMatchObject({
      mode: "incremental",
      invoices: { created: 0, updated: 2, unchanged: 0, deleted: 0 },
      payments: { created: 1, updated: 0, removed: 1 },
    });

    const stored = await listInvoices(db, organizationId);
    const first = stored.find((row) => row.externalId === "1");
    expect(first).toMatchObject({ sourceStatus: "paid", paidOn: "2026-10-11" });
    expect(await countInvoiceLines(db, organizationId, first?.id ?? "")).toBe(2);
    expect((await listInvoicePayments(db, organizationId)).map((row) => row.externalId)).toEqual([
      "p9",
    ]);
  });

  it("an incremental sync fetches clients only when an invoice refers to an unknown one", async () => {
    const { scope, organizationId } = await connected("Firma A");
    const provider = seeded();
    await syncInvoices({ db, scope, provider, mode: "full", now: NOW });
    provider.calls.length = 0;

    provider.clients.push(client("c3", "Nový klient s.r.o."));
    provider.invoices.push(
      invoice("4", { clientExternalId: "c3", sourceUpdatedAt: new Date("2026-10-11T08:30:00Z") }),
    );
    await syncInvoices({
      db,
      scope,
      provider,
      mode: "incremental",
      now: new Date("2026-10-11T09:00:00Z"),
    });

    expect(provider.calls.some((call) => call.method === "listClients")).toBe(true);
    const companies = await listCompanies(db, organizationId);
    const fourth = (await listInvoices(db, organizationId)).find((row) => row.externalId === "4");
    expect(fourth?.companyId).toBe(companies.find((row) => row.externalId === "c3")?.id);
  });

  it("fetches payments separately for invoices that come without them", async () => {
    const { scope, organizationId } = await connected("Firma A");
    const provider = new InMemoryProvider();
    provider.clients = [client("c1")];
    provider.invoices = [
      // Nothing paid: the provider says so itself and no request is needed.
      invoice("1"),
      invoice("2", { payments: null }),
      invoice("3", { payments: null, sourceStatus: "paid", paidOn: "2026-10-05" }),
    ];
    provider.payments = [
      payment("p1", "2", 20_000n),
      payment("p2", "2", 30_000n),
      payment("p3", "2", 1_000n),
      payment("p4", "3", 121_000n),
      // Of an invoice nobody asked about: must not be stored.
      payment("p9", "1", 5n),
    ];

    const first = await syncInvoices({ db, scope, provider, mode: "full", now: NOW });

    expect(first.payments).toEqual({ created: 4, updated: 0, removed: 0 });
    const stored = await listInvoicePayments(db, organizationId);
    expect(stored.map((row) => row.externalId).sort()).toEqual(["p1", "p2", "p3", "p4"]);
    // Only the two invoices without payments are asked about (page by page: invoice 2
    // has three payments and the provider returns two at a time).
    const asked = provider.calls
      .filter((call) => call.method === "listPayments")
      .map((call) => [...(call.options?.invoiceExternalIds ?? [])]);
    expect(asked).toEqual([["2"], ["2"], ["3"]]);

    // A payment removed at the source disappears here as well; nothing is duplicated.
    provider.payments = provider.payments.filter((item) => item.externalId !== "p3");
    const second = await syncInvoices({ db, scope, provider, mode: "full", now: NOW });

    expect(second.payments).toMatchObject({ created: 0, removed: 1 });
    const after = await listInvoicePayments(db, organizationId);
    expect(after.map((row) => row.externalId).sort()).toEqual(["p1", "p2", "p4"]);
  });

  it("makes no payment request when every invoice carries its payments", async () => {
    const { scope } = await connected("Firma A");
    const provider = seeded();

    await syncInvoices({ db, scope, provider, mode: "full", now: NOW });

    expect(provider.calls.some((call) => call.method === "listPayments")).toBe(false);
  });

  it("does not move the cursor when the provider fails half-way", async () => {
    const { scope, organizationId } = await connected("Firma A");
    const provider = seeded();
    const failing = withRequestHook(provider, async () => {
      if (provider.calls.length >= 2) throw new Error("outage");
    });

    await expect(
      syncInvoices({ db, scope, provider: failing, mode: "full", now: NOW }),
    ).rejects.toThrow("outage");
    expect(await getSyncCursor(db, organizationId, scope.connectionId, "invoices")).toBeNull();

    // The repeated run finishes the job without duplicating what the first one stored.
    await syncInvoices({ db, scope, provider, mode: "full", now: NOW });
    expect(await listInvoices(db, organizationId)).toHaveLength(3);
    expect(await listCompanies(db, organizationId)).toHaveLength(2);
  });

  it("keeps organizations apart even when their external ids are the same", async () => {
    const a = await connected("Firma A");
    const b = await connected("Firma B");
    const providerA = seeded();
    const providerB = new InMemoryProvider();
    providerB.clients = [client("c1", "Úplně jiný klient")];
    providerB.invoices = [invoice("1", { totalMinor: 999n, subtotalMinor: 999n, vatMinor: 0n })];

    await syncInvoices({ db, scope: a.scope, provider: providerA, mode: "full", now: NOW });
    await syncInvoices({ db, scope: b.scope, provider: providerB, mode: "full", now: NOW });

    expect(await listInvoices(db, a.organizationId)).toHaveLength(3);
    const ofB = await listInvoices(db, b.organizationId);
    expect(ofB).toHaveLength(1);
    expect(ofB[0]?.totalMinor).toBe(999n);
    expect((await listCompanies(db, b.organizationId)).map((row) => row.name)).toEqual([
      "Úplně jiný klient",
    ]);

    // A sync of B that no longer has invoice "1" must not touch A's invoice "1".
    providerB.invoices = [];
    await syncInvoices({ db, scope: b.scope, provider: providerB, mode: "full", now: NOW });
    expect(await listInvoices(db, b.organizationId)).toHaveLength(0);
    expect(await listInvoices(db, a.organizationId)).toHaveLength(3);
  });

  it("refuses to write through a connection of another organization", async () => {
    const a = await connected("Firma A");
    const b = await connected("Firma B");
    const mixed = { organizationId: a.organizationId, connectionId: b.scope.connectionId };
    await expect(
      syncInvoices({ db, scope: mixed, provider: seeded(), mode: "full", now: NOW }),
    ).rejects.toThrow();
    expect(await listInvoices(db, a.organizationId)).toHaveLength(0);
  });
});

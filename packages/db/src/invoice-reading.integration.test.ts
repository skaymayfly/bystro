import { randomBytes } from "node:crypto";

import { Secret, type Client, type Invoice } from "@bystro/core";
import { afterAll, describe, expect, it } from "vitest";

import { createDb } from "./client";
import { saveConnection } from "./integrations";
import {
  getInvoiceDetail,
  hideSyncedData,
  listInvoiceOverview,
  upsertCompanies,
  upsertInvoices,
  type SyncScope,
} from "./invoices";
import { createTestOrganization } from "./test/fixtures";
import { readTestDatabase } from "./test/test-database";

const { db, close } = createDb(readTestDatabase().url);

afterAll(async () => {
  await close();
});

const SOURCE = "fakturoid";

async function connected(name: string): Promise<SyncScope> {
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
  return { organizationId: organization.id, connectionId: connection.id };
}

const client: Client = {
  source: SOURCE,
  externalId: "c1",
  sourceUpdatedAt: null,
  name: "Novák s.r.o.",
  ico: "27074358",
  dic: null,
  street: null,
  city: "Praha",
  postalCode: null,
  country: "CZ",
  email: "jan@novak.example",
  phone: null,
};

const invoice = (externalId: string, overrides: Partial<Invoice> = {}): Invoice => ({
  source: SOURCE,
  externalId,
  sourceUpdatedAt: null,
  number: `2026-${externalId}`,
  variableSymbol: `2026${externalId}`,
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
      externalId: `${externalId}#2`,
      position: 2,
      description: "Doprava",
      quantityMilli: 1_000,
      unit: null,
      unitPriceMinor: 20_000n,
      vatRateBasisPoints: 2_100,
      totalMinor: 24_200n,
    },
    {
      externalId: `${externalId}#1`,
      position: 1,
      description: "Montáž",
      quantityMilli: 2_000,
      unit: "h",
      unitPriceMinor: 40_000n,
      vatRateBasisPoints: 2_100,
      totalMinor: 96_800n,
    },
  ],
  payments: [],
  ...overrides,
});

const payment = (
  externalId: string,
  invoiceExternalId: string,
  amountMinor: bigint,
  currency = "CZK",
) => ({
  source: SOURCE,
  externalId,
  sourceUpdatedAt: null,
  invoiceExternalId,
  paidOn: "2026-10-01" as const,
  amountMinor,
  currency,
});

describe("listInvoiceOverview", () => {
  it("returns invoices with the client's name and the sum of their payments", async () => {
    const scope = await connected("Firma A");
    await upsertCompanies(db, scope, [client]);
    await upsertInvoices(db, scope, [
      invoice("01", { payments: [payment("p1", "01", 50_000n), payment("p2", "01", 21_000n)] }),
      invoice("02", { clientExternalId: null, dueOn: "2026-09-01" }),
      // A payment in another currency does not count towards a crown invoice.
      invoice("03", { dueOn: "2026-11-01", payments: [payment("p3", "03", 121_000n, "EUR")] }),
    ]);

    const overview = await listInvoiceOverview(db, scope.organizationId);
    expect(overview.map((row) => [row.number, row.clientName, row.paidMinor])).toEqual([
      ["2026-02", null, 0n],
      ["2026-01", "Novák s.r.o.", 71_000n],
      ["2026-03", "Novák s.r.o.", 0n],
    ]);
    expect(overview[1]).toMatchObject({
      kind: "invoice",
      sourceStatus: "open",
      issuedOn: "2026-09-20",
      dueOn: "2026-10-04",
      currency: "CZK",
      totalMinor: 121_000n,
    });
  });

  it("stops counting a payment that was removed at the source", async () => {
    const scope = await connected("Firma A");
    await upsertInvoices(db, scope, [invoice("01", { payments: [payment("p1", "01", 50_000n)] })]);
    await upsertInvoices(db, scope, [invoice("01", { payments: [] })]);

    const [row] = await listInvoiceOverview(db, scope.organizationId);
    expect(row?.paidMinor).toBe(0n);
  });

  it("shows nothing of another organization and nothing that was hidden", async () => {
    const a = await connected("Firma A");
    const b = await connected("Firma B");
    await upsertInvoices(db, a, [invoice("01", { clientExternalId: null })]);
    await upsertInvoices(db, b, [invoice("01", { clientExternalId: null, totalMinor: 999n })]);

    expect(await listInvoiceOverview(db, a.organizationId)).toHaveLength(1);
    expect((await listInvoiceOverview(db, b.organizationId))[0]?.totalMinor).toBe(999n);

    await hideSyncedData(db, a);
    expect(await listInvoiceOverview(db, a.organizationId)).toEqual([]);
    expect(await listInvoiceOverview(db, b.organizationId)).toHaveLength(1);
  });
});

describe("getInvoiceDetail", () => {
  it("returns the invoice with its client, lines in order and payments", async () => {
    const scope = await connected("Firma A");
    await upsertCompanies(db, scope, [client]);
    await upsertInvoices(db, scope, [invoice("01", { payments: [payment("p1", "01", 50_000n)] })]);
    const [listed] = await listInvoiceOverview(db, scope.organizationId);

    const detail = await getInvoiceDetail(db, scope.organizationId, listed?.id ?? "");
    expect(detail?.invoice).toMatchObject({ number: "2026-01", variableSymbol: "202601" });
    expect(detail?.company).toMatchObject({ name: "Novák s.r.o.", email: "jan@novak.example" });
    expect(detail?.lines.map((line) => line.description)).toEqual(["Montáž", "Doprava"]);
    expect(detail?.payments.map((row) => row.amountMinor)).toEqual([50_000n]);
  });

  it("does not find an invoice of another organization, a deleted one or a made-up id", async () => {
    const a = await connected("Firma A");
    const b = await connected("Firma B");
    await upsertInvoices(db, a, [invoice("01", { clientExternalId: null })]);
    const [ofA] = await listInvoiceOverview(db, a.organizationId);
    const id = ofA?.id ?? "";

    expect(await getInvoiceDetail(db, a.organizationId, id)).not.toBeNull();
    expect(await getInvoiceDetail(db, b.organizationId, id)).toBeNull();
    expect(
      await getInvoiceDetail(db, a.organizationId, "0b0e8a52-5f0c-4d6e-9d57-0e6f0a5f3c11"),
    ).toBeNull();

    await hideSyncedData(db, a);
    expect(await getInvoiceDetail(db, a.organizationId, id)).toBeNull();
  });
});

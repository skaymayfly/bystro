import { randomBytes, randomUUID } from "node:crypto";

import { Secret } from "@bystro/core";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { createDb } from "./client";
import { saveConnection } from "./integrations";
import { companies, contacts, invoiceLines, invoicePayments, invoices } from "./schema";
import {
  createTestOrganization,
  expectPgError,
  PG_CHECK_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
} from "./test/fixtures";
import { readTestDatabase } from "./test/test-database";

const { db, close } = createDb(readTestDatabase().url);
const key = randomBytes(32);

afterAll(async () => {
  await close();
});

/** An organization with a Fakturoid connection, as after step 2.6. */
async function connectedOrganization(name: string) {
  const { organization, owner } = await createTestOrganization(db, name);
  const connection = await saveConnection(
    db,
    organization.id,
    {
      provider: "fakturoid",
      category: "invoicing",
      scopes: [],
      tokens: { accessToken: new Secret("token"), refreshToken: null, expiresAt: null },
      userId: owner.id,
      source: "web",
    },
    key,
  );
  return { organizationId: organization.id, connectionId: connection.id };
}

type Tenant = Awaited<ReturnType<typeof connectedOrganization>>;

const external = (tenant: Tenant, externalId: string = randomUUID()) => ({
  organizationId: tenant.organizationId,
  connectionId: tenant.connectionId,
  source: "fakturoid",
  externalId,
});

async function insertCompany(tenant: Tenant, externalId?: string) {
  const [row] = await db
    .insert(companies)
    .values({ ...external(tenant, externalId), name: "Novák s.r.o.", ico: "27074358" })
    .returning();
  if (row === undefined) throw new Error("no company");
  return row;
}

const invoiceValues = (tenant: Tenant, overrides: Partial<typeof invoices.$inferInsert> = {}) => ({
  ...external(tenant),
  number: "2026-0042",
  variableSymbol: "20260042",
  kind: "invoice" as const,
  direction: "issued" as const,
  sourceStatus: "open" as const,
  issuedOn: "2026-10-01",
  dueOn: "2026-10-15",
  currency: "CZK",
  subtotalMinor: 3_983_471n,
  vatMinor: 836_529n,
  totalMinor: 4_820_000n,
  ...overrides,
});

async function insertInvoice(
  tenant: Tenant,
  overrides: Partial<typeof invoices.$inferInsert> = {},
) {
  const [row] = await db.insert(invoices).values(invoiceValues(tenant, overrides)).returning();
  if (row === undefined) throw new Error("no invoice");
  return row;
}

describe("invoice tables", () => {
  it("store a whole invoice with exact amounts and days without time", async () => {
    const tenant = await connectedOrganization("Firma A");
    const company = await insertCompany(tenant);
    await db
      .insert(contacts)
      .values({ ...external(tenant), companyId: company.id, name: "Jan Novák" });
    const invoice = await insertInvoice(tenant, {
      companyId: company.id,
      // Above 2^53: must come back exactly, so never through a JS number.
      totalMinor: 9_007_199_254_740_993n,
    });
    await db.insert(invoiceLines).values({
      ...external(tenant, `${invoice.externalId}#1`),
      invoiceId: invoice.id,
      position: 1,
      description: "Kuchyňská linka",
      quantityMilli: 1_500,
      unit: "ks",
      unitPriceMinor: 2_655_647n,
      vatRateBasisPoints: 2_100,
      totalMinor: 4_820_000n,
    });
    await db.insert(invoicePayments).values({
      ...external(tenant),
      invoiceId: invoice.id,
      paidOn: "2026-10-10",
      amountMinor: 1_000_000n,
      currency: "CZK",
    });

    const [stored] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(stored).toMatchObject({
      totalMinor: 9_007_199_254_740_993n,
      dueOn: "2026-10-15",
      issuedOn: "2026-10-01",
      kind: "invoice",
      direction: "issued",
      deletedAt: null,
    });
    expect(stored?.syncedAt).toBeInstanceOf(Date);
    const [payment] = await db
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, invoice.id));
    expect(payment).toMatchObject({ amountMinor: 1_000_000n, paidOn: "2026-10-10" });
  });

  it("refuses a second object with the same source and external id in one organization", async () => {
    const tenant = await connectedOrganization("Firma A");
    await insertCompany(tenant, "client-7");
    await expectPgError(insertCompany(tenant, "client-7"), PG_UNIQUE_VIOLATION);

    const invoice = await insertInvoice(tenant);
    await expectPgError(
      insertInvoice(tenant, { externalId: invoice.externalId }),
      PG_UNIQUE_VIOLATION,
    );
  });

  it("allows the same external id in another organization", async () => {
    const a = await connectedOrganization("Firma A");
    const b = await connectedOrganization("Firma B");
    await insertCompany(a, "client-1");
    await expect(insertCompany(b, "client-1")).resolves.toMatchObject({ externalId: "client-1" });
  });

  it("refuses to link data of two organizations", async () => {
    const a = await connectedOrganization("Firma A");
    const b = await connectedOrganization("Firma B");
    const companyOfB = await insertCompany(b);
    const invoiceOfB = await insertInvoice(b);

    // An invoice of A pointing at a company of B.
    await expectPgError(insertInvoice(a, { companyId: companyOfB.id }), PG_FOREIGN_KEY_VIOLATION);
    // A payment of A on an invoice of B.
    await expectPgError(
      db.insert(invoicePayments).values({
        ...external(a),
        invoiceId: invoiceOfB.id,
        paidOn: "2026-10-10",
        amountMinor: 100n,
        currency: "CZK",
      }),
      PG_FOREIGN_KEY_VIOLATION,
    );
    // An invoice of A synced through the connection of B.
    await expectPgError(
      insertInvoice({ organizationId: a.organizationId, connectionId: b.connectionId }),
      PG_FOREIGN_KEY_VIOLATION,
    );
  });

  it("checks currency, amount sign, variable symbol and VAT rate", async () => {
    const tenant = await connectedOrganization("Firma A");
    await expectPgError(insertInvoice(tenant, { currency: "czk" }), PG_CHECK_VIOLATION);
    await expectPgError(insertInvoice(tenant, { totalMinor: -1n }), PG_CHECK_VIOLATION);
    await expectPgError(insertInvoice(tenant, { variableSymbol: "VS-42" }), PG_CHECK_VIOLATION);
    await expectPgError(
      insertInvoice(tenant, { variableSymbol: "12345678901" }),
      PG_CHECK_VIOLATION,
    );
    await expect(
      insertInvoice(tenant, { kind: "credit_note", totalMinor: -500_000n, variableSymbol: null }),
    ).resolves.toMatchObject({ totalMinor: -500_000n });

    const invoice = await insertInvoice(tenant);
    await expectPgError(
      db.insert(invoiceLines).values({
        ...external(tenant),
        invoiceId: invoice.id,
        position: 1,
        description: "Montáž",
        vatRateBasisPoints: 21_000,
        totalMinor: 100n,
      }),
      PG_CHECK_VIOLATION,
    );
    await expectPgError(
      db.insert(companies).values({ ...external(tenant), name: "X", country: "Česko" }),
      PG_CHECK_VIOLATION,
    );
  });
});

import { formatCzk, todayInPrague, type Client, type DateOnly, type Invoice } from "@bystro/core";
import {
  applyConnectionEvent,
  createDb,
  listConnections,
  listOrganizationsForUser,
  upsertCompanies,
  upsertInvoices,
} from "@bystro/db";
import { readTestDatabase } from "@bystro/db/testing";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { completeOnboarding, createSignedInUser } from "./helpers";

const SOURCE = "fakturoid";
const system = { actor: { type: "system" as const }, source: "worker" as const };

/** A day relative to today in Prague, so that statuses do not depend on when the test runs. */
function day(offset: number): DateOnly {
  const [year, month, date] = todayInPrague(new Date()).split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, date + offset)).toISOString().slice(0, 10) as DateOnly;
}

const client = (externalId: string, name: string): Client => ({
  source: SOURCE,
  externalId,
  sourceUpdatedAt: null,
  name,
  ico: null,
  dic: null,
  street: null,
  city: null,
  postalCode: null,
  country: "CZ",
  email: `${externalId}@example.test`,
  phone: null,
});

const invoice = (number: string, overrides: Partial<Invoice>): Invoice => ({
  source: SOURCE,
  externalId: number,
  sourceUpdatedAt: null,
  number,
  variableSymbol: number.replace(/\D/g, ""),
  kind: "invoice",
  direction: "issued",
  sourceStatus: "open",
  clientExternalId: "novak",
  issuedOn: day(-30),
  taxableSupplyOn: null,
  dueOn: day(20),
  paidOn: null,
  currency: "CZK",
  subtotalMinor: 0n,
  vatMinor: 0n,
  totalMinor: 0n,
  lines: [],
  payments: [],
  ...overrides,
});

const INVOICES: Invoice[] = [
  invoice("2026-0142", {
    dueOn: day(-12),
    totalMinor: 11_200_000n,
    lines: [
      {
        externalId: "2026-0142#1",
        position: 1,
        description: "Kuchyňská linka na míru",
        quantityMilli: 1_000,
        unit: "ks",
        unitPriceMinor: 9_256_198n,
        vatRateBasisPoints: 2_100,
        totalMinor: 11_200_000n,
      },
    ],
    payments: [
      {
        source: SOURCE,
        externalId: "pay-1",
        sourceUpdatedAt: null,
        invoiceExternalId: "2026-0142",
        paidOn: day(-20),
        amountMinor: 1_200_000n,
        currency: "CZK",
      },
    ],
  }),
  invoice("2026-0137", { clientExternalId: "pekarna", dueOn: day(-5), totalMinor: 1_840_000n }),
  invoice("2026-0151", { clientExternalId: "zeleny", dueOn: day(3), totalMinor: 12_800_000n }),
  invoice("2026-0149", { clientExternalId: "zeleny", dueOn: day(40), totalMinor: 4_250_000n }),
  invoice("2026-0145", {
    clientExternalId: "pekarna",
    dueOn: day(-14),
    sourceStatus: "paid",
    paidOn: day(-16),
    totalMinor: 2_360_000n,
  }),
  invoice("2026-0160", { clientExternalId: "zeleny", currency: "EUR", totalMinor: 150_000n }),
  invoice("2026-0099", { sourceStatus: "cancelled", totalMinor: 999_900n }),
];

/** Connects Fakturoid in the browser (through the stand-in) and stores synced invoices. */
async function companyWithInvoices(page: Page): Promise<void> {
  const { userId } = await createSignedInUser(page.context());
  await page.goto("/onboarding");
  await completeOnboarding(page);
  await page.goto("/app/nastaveni?karta=propojeni");
  await page.getByRole("button", { name: "Fakturoid", exact: true }).click();
  await page.getByRole("button", { name: "Propojit" }).click();
  await expect(page).toHaveURL(/propojeni=ok/);

  // What the worker would have done; no worker runs in E2E.
  const { db, close } = createDb(readTestDatabase().url);
  try {
    const [membership] = await listOrganizationsForUser(db, userId);
    const organizationId = membership?.organization.id as string;
    const [connection] = await listConnections(db, organizationId);
    const scope = { organizationId, connectionId: connection?.id as string };
    await upsertCompanies(db, scope, [
      client("novak", "Novák s.r.o."),
      client("pekarna", "Pekárna U Mlýna"),
      client("zeleny", "Zelený dům a.s."),
    ]);
    await upsertInvoices(db, scope, INVOICES);
    await applyConnectionEvent(db, organizationId, scope.connectionId, "sync_started", system);
    await applyConnectionEvent(db, organizationId, scope.connectionId, "sync_succeeded", system);
  } finally {
    await close();
  }
}

const listed = (page: Page) => page.getByRole("list", { name: "Faktury" }).getByRole("link");

test.describe.configure({ mode: "serial" });
let storageStatePath: string;

test.beforeAll(async ({ browser }, testInfo) => {
  storageStatePath = testInfo.outputPath("session.json");
  const context = await browser.newContext();
  await companyWithInvoices(await context.newPage());
  await context.storageState({ path: storageStatePath });
  await context.close();
});

async function signedIn(browser: Browser, width = 1440): Promise<Page> {
  const context = await browser.newContext({
    storageState: storageStatePath,
    viewport: { width, height: 900 },
  });
  return context.newPage();
}

test("seznam faktur ukáže součty, které sedí s daty, a řadí od nejdéle po splatnosti", async ({
  browser,
}) => {
  const page = await signedIn(browser);
  await page.goto("/app/faktury");

  // 6 listed (the cancelled one is left out); waiting = overdue remainder + not yet due.
  const overdue = 11_200_000n - 1_200_000n + 1_840_000n;
  const pending = 12_800_000n + 4_250_000n;
  await expect(
    page.getByText(`6 faktur · ${formatCzk(overdue + pending)} čeká na zaplacení`),
  ).toBeVisible();

  const cards = page.locator("a[href^='/app/faktury?stav=']");
  await expect(cards.filter({ hasText: "Po splatnosti" }).first()).toContainText(
    formatCzk(overdue),
  );
  await expect(cards.filter({ hasText: "Po splatnosti" }).first()).toContainText("2 faktury");
  await expect(cards.filter({ hasText: "Čeká na platbu" })).toContainText(formatCzk(pending));
  // The euro invoice is counted, but its amount is not added to crowns.
  await expect(cards.filter({ hasText: "Čeká na platbu" })).toContainText("3 faktury");
  await expect(cards.filter({ hasText: "Zaplaceno" }).first()).toContainText(formatCzk(2_360_000n));
  await expect(
    page.getByText("1 faktura v jiné měně do součtů v korunách nepočítám."),
  ).toBeVisible();
  await expect(page.getByText("Zdroj: Fakturoid · aktualizováno před chvílí")).toBeVisible();

  await expect(listed(page)).toHaveCount(6);
  await expect(listed(page).first()).toContainText("2026-0142");
  await expect(listed(page).first()).toContainText("12 dní po splatnosti");
  await expect(listed(page).nth(2)).toContainText("Splatná za 3 dny");
  await expect(listed(page).last()).toContainText("Zaplaceno");
  await expect(page.getByText("2026-0099")).toHaveCount(0);
  await expect(page.getByText("1 500 EUR")).toBeVisible();

  // Nothing overflows sideways on a phone; the table scrolls inside its card.
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.context().close();
});

test("filtry, hledání a řazení", async ({ browser }) => {
  const page = await signedIn(browser);
  await page.goto("/app/faktury");
  const filters = page.getByRole("navigation", { name: "Filtr faktur" });

  await filters.getByRole("link", { name: "Po splatnosti" }).click();
  await expect(page).toHaveURL("/app/faktury?stav=po-splatnosti");
  await expect(listed(page)).toHaveCount(2);

  await filters.getByRole("link", { name: "Brzy splatné" }).click();
  await expect(listed(page)).toHaveCount(1);
  await expect(listed(page).first()).toContainText("2026-0151");

  await filters.getByRole("link", { name: "Čeká" }).click();
  await expect(listed(page)).toHaveCount(3);

  await filters.getByRole("link", { name: "Zaplaceno" }).click();
  await expect(listed(page)).toHaveCount(1);
  await expect(listed(page).first()).toContainText("Pekárna U Mlýna");

  // Search keeps the filter; without diacritics, any case.
  await filters.getByRole("link", { name: "Vše" }).click();
  await expect(page).toHaveURL("/app/faktury");
  const search = page.getByRole("searchbox", { name: "Hledat klienta nebo číslo" });
  await search.fill("zeleny");
  await search.press("Enter");
  await expect(page).toHaveURL("/app/faktury?q=zeleny");
  await expect(listed(page)).toHaveCount(3);

  await page.getByRole("link", { name: "Seřadit podle: Částka" }).click();
  await expect(page).toHaveURL("/app/faktury?q=zeleny&razeni=castka");
  await expect(listed(page).first()).toContainText("2026-0151");

  await search.fill("neexistuje");
  await search.press("Enter");
  await expect(
    page.getByText("Nic jsem nenašel. Zkus jiný filtr nebo hledaný výraz."),
  ).toBeVisible();
  await page.context().close();
});

test("detail faktury a karta Po splatnosti na Přehledu", async ({ browser }) => {
  const page = await signedIn(browser);
  await page.goto("/app");

  await expect(page.getByText("2 faktury jsou po splatnosti")).toBeVisible();
  const overdue = 11_200_000n - 1_200_000n + 1_840_000n;
  await expect(page.getByText(formatCzk(overdue))).toBeVisible();
  await expect(page.getByText("2 faktury · nejstarší 12 dní po splatnosti")).toBeVisible();
  await expect(page.getByRole("img", { name: "Bystrouš hlídá" })).toBeVisible();
  await expect(page.getByText("Zdroj: Fakturoid · aktualizováno před")).toBeVisible();

  await page.getByRole("link", { name: /Novák s\.r\.o\..*2026-0142/ }).click();
  await expect(page).toHaveURL(/\/app\/faktury\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Novák s.r.o." })).toBeVisible();
  await expect(page.getByText("12 dní po splatnosti")).toBeVisible();
  // The remainder, with the part that already came.
  await expect(page.getByText(formatCzk(10_000_000n), { exact: true })).toBeVisible();
  await expect(
    page.getByText(`Z ${formatCzk(11_200_000n)} už přišlo ${formatCzk(1_200_000n)}.`),
  ).toBeVisible();
  await expect(page.getByText("20260142")).toBeVisible();
  await expect(page.getByText("novak@example.test")).toBeVisible();
  await expect(page.getByText("Kuchyňská linka na míru")).toBeVisible();
  await expect(page.getByText("Faktura vystavena")).toBeVisible();
  await expect(page.getByText(`Přijata platba ${formatCzk(1_200_000n)}`)).toBeVisible();
  await expect(page.getByText("Splatnost vypršela")).toBeVisible();
  // No actions yet: nothing here writes to Fakturoid or sends anything.
  await expect(page.getByRole("button", { name: /připomínk|zaplacené/i })).toHaveCount(0);

  await page.getByRole("link", { name: "Faktury" }).first().click();
  await expect(page).toHaveURL("/app/faktury");
  await page.context().close();
});

test("cizí ani vymyšlenou fakturu otevřít nejde", async ({ browser, page }) => {
  const owner = await signedIn(browser);
  await owner.goto("/app/faktury");
  const href = await listed(owner).first().getAttribute("href");
  expect(href).toMatch(/^\/app\/faktury\/[0-9a-f-]{36}$/);
  await owner.context().close();

  // Another company, signed in, tries the same address.
  await createSignedInUser(page.context());
  await page.goto("/onboarding");
  await completeOnboarding(page);
  const foreign = await page.goto(href as string);
  expect(foreign?.status()).toBe(404);
  await expect(page.getByText("Novák s.r.o.")).toHaveCount(0);

  expect((await page.goto("/app/faktury/0b0e8a52-5f0c-4d6e-9d57-0e6f0a5f3c11"))?.status()).toBe(
    404,
  );
  expect((await page.goto("/app/faktury/neni-id"))?.status()).toBe(404);

  // And this company's own list is empty.
  await page.goto("/app/faktury");
  await expect(page.getByText("Zatím tu žádné faktury nejsou")).toBeVisible();
});

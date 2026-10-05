import { randomUUID } from "node:crypto";

import { expect, test, type Browser, type Page } from "@playwright/test";

/** Each screen with a text that only its empty state shows. */
const SCREENS = [
  { label: "Přehled", path: "/app", text: "Faktury zatím nevidím" },
  { label: "Asistent", path: "/app/asistent", text: "Ptej se, jako by ses ptal účetní." },
  { label: "Hlídač peněz", path: "/app/hlidac-penez", text: "Bez banky nevím, kolik ti zbude" },
  { label: "Faktury", path: "/app/faktury", text: "Zatím tu žádné faktury nejsou" },
  {
    label: "Nastavení",
    path: "/app/nastaveni",
    text: "Přístup jen pro čtení. Odpojit můžeš kdykoliv.",
  },
] as const;

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const PASSWORD = "tajne-heslo-123";
const email = `e2e-${randomUUID()}@example.test`;

// One account for the whole file: sign-up and sign-in are rate limited in production mode,
// so the tests share a session instead of registering again and again.
test.describe.configure({ mode: "serial" });
let storageStatePath: string;

test.beforeAll(async ({ browser }, testInfo) => {
  storageStatePath = testInfo.outputPath("session.json");
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/registrace");
  await page.getByLabel("Jméno a příjmení").fill("Petr Dvořák");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Heslo").fill(PASSWORD);
  await page.getByRole("button", { name: "Vytvořit účet" }).click();
  await expect(page).toHaveURL("/app");
  await context.storageState({ path: storageStatePath });
  await context.close();
});

/** Opens a page that is already signed in as the shared account. */
async function signedInPage(
  browser: Browser,
  viewport: { width: number; height: number },
): Promise<Page> {
  const context = await browser.newContext({ storageState: storageStatePath, viewport });
  return context.newPage();
}

async function visitEveryScreen(page: Page, shots: string) {
  const nav = page.getByRole("navigation", { name: "Hlavní navigace" });
  for (const screen of SCREENS) {
    await nav.getByRole("link", { name: screen.label }).click();
    await expect(page).toHaveURL(screen.path);
    await expect(page.getByText(screen.text)).toBeVisible();
    await expect(nav.getByRole("link", { name: screen.label })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Nothing may overflow sideways, on any screen size.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: test.info().outputPath(`${shots}-${screen.path.split("/").at(-1)}.png`),
      fullPage: true,
    });
  }
}

test("navigace na počítači projde všechny obrazovky s prázdnými stavy", async ({ browser }) => {
  const page = await signedInPage(browser, DESKTOP);
  await page.goto("/app");

  // Sidebar shows who is signed in and that no company exists yet.
  await expect(page.getByText("Petr Dvořák")).toBeVisible();
  await expect(page.getByText("Firma zatím není založená")).toBeVisible();

  await visitEveryScreen(page, "desktop");
  await page.context().close();
});

test("navigace na mobilu projde všechny obrazovky s prázdnými stavy", async ({ browser }) => {
  const page = await signedInPage(browser, MOBILE);
  await page.goto("/app");

  await visitEveryScreen(page, "mobile");
  await page.context().close();
});

test("prvky z pozdějších fází jsou neaktivní a označené jako Připravujeme", async ({ browser }) => {
  const page = await signedInPage(browser, DESKTOP);
  await page.goto("/app");

  await expect(page.getByRole("button", { name: "Připojit fakturaci" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Připojit banku" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Připojit e-mail" })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Otázka pro asistenta" })).toBeDisabled();
  await expect(page.getByText("Připravujeme").first()).toBeVisible();

  await page.goto("/app/faktury");
  await expect(page.getByRole("button", { name: "Připojit fakturaci" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Nahrát PDF faktury" })).toHaveCount(0);

  await page.goto("/app/nastaveni");
  await expect(page.getByRole("button", { name: "7:00" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "100 000 Kč" })).toBeDisabled();
  await page.context().close();
});

test("vnořené stránky aplikace jsou bez přihlášení zavřené", async ({ page }) => {
  for (const screen of SCREENS) {
    await page.goto(screen.path);
    await expect(page).toHaveURL(/\/prihlaseni\?next=/);
  }
});

// Last on purpose: signing out ends the session the tests above share.
test("po odhlášení a přihlášení se uživatel vrátí na stránku, kterou chtěl otevřít", async ({
  browser,
}) => {
  const page = await signedInPage(browser, MOBILE);
  await page.goto("/app");
  await page.getByRole("button", { name: "Odejít" }).click();
  await expect(page).toHaveURL("/prihlaseni");

  await page.goto("/app/faktury");
  await expect(page).toHaveURL(/\/prihlaseni\?next=%2Fapp%2Ffaktury$/);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Heslo").fill(PASSWORD);
  await page.getByRole("button", { name: "Přihlásit se" }).click();

  await expect(page).toHaveURL("/app/faktury");
  await expect(page.getByText("Zatím tu žádné faktury nejsou")).toBeVisible();
  await page.context().close();
});

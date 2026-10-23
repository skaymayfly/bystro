import {
  createDb,
  listConnections,
  listOrganizationsForUser,
  readConnectionTokens,
} from "@bystro/db";
import { readTestDatabase } from "@bystro/db/testing";
import { expect, test, type Page } from "@playwright/test";

import { E2E_ENCRYPTION_KEY, GOOGLE_STUB_URL } from "./config";
import { completeOnboarding, createSignedInUser } from "./helpers";

const key = Buffer.from(E2E_ENCRYPTION_KEY, "base64");

async function storedMailbox(userId: string) {
  const { db, close } = createDb(readTestDatabase().url);
  try {
    const [membership] = await listOrganizationsForUser(db, userId);
    const organizationId = membership?.organization.id ?? "";
    const [connection] = (await listConnections(db, organizationId)).filter(
      (item) => item.provider === "gmail",
    );
    if (connection === undefined) return null;
    return {
      status: connection.status,
      category: connection.category,
      tokens: await readConnectionTokens(db, organizationId, connection.id, key),
    };
  } finally {
    await close();
  }
}

async function revocations(page: Page): Promise<number> {
  const response = await page.request.get(`${GOOGLE_STUB_URL}/__revocations`);
  return ((await response.json()) as { count: number }).count;
}

test("Pošta: propojení Gmailu → stav → odpojení; tokeny nikdy v prohlížeči", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { userId } = await createSignedInUser(page.context());
  await page.goto("/onboarding");
  await completeOnboarding(page);

  // From Přehled to Pošta, and from there to (the stand-in for) Google and back.
  await page.getByRole("link", { name: "Připojit e-mail" }).click();
  await expect(page).toHaveURL("/app/posta");
  await expect(page.getByRole("heading", { name: "E-mail zatím není propojený" })).toBeVisible();
  await page.getByRole("button", { name: "Propojit e-mail" }).click();

  await expect(page).toHaveURL("/app/posta?zdroj=propojeni&propojeni=ok&aplikace=gmail");
  await expect(page.getByText("Gmail je propojený.")).toBeVisible();
  await expect(page.getByText("Gmail · petr@dvorak-interiery.cz · připojeno")).toBeVisible();
  expect(await page.content()).not.toMatch(/stub-google-access-token|stub-google-refresh-token/);

  const stored = await storedMailbox(userId);
  expect(stored).toMatchObject({ status: "connected", category: "email" });
  expect(stored?.tokens?.refreshToken?.reveal()).toBe("stub-google-refresh-token");

  // In Nastavení → Propojení: connected, nothing to refresh by hand, no invoices waited for.
  await page.goto("/app/nastaveni?karta=propojeni");
  const item = page.getByRole("listitem").filter({ hasText: "E-mail · petr@dvorak-interiery.cz" });
  await expect(item.getByRole("status")).toHaveText("Připojeno");
  await expect(item.getByRole("button", { name: "Aktualizovat" })).toHaveCount(0);
  await page.getByRole("button", { name: "Gmail", exact: true }).click();
  await expect(page.getByText("Gmail je propojený. Stav a odpojení najdeš")).toBeVisible();

  // Disconnecting revokes the access at Google and forgets the tokens.
  const before = await revocations(page);
  page.once("dialog", (dialog) => void dialog.accept());
  await item.getByRole("button", { name: "Odpojit" }).click();
  await expect(page.getByText("E-mail · petr@dvorak-interiery.cz")).toHaveCount(0);
  expect(await revocations(page)).toBe(before + 1);
  expect(await storedMailbox(userId)).toEqual({
    status: "revoked",
    category: "email",
    tokens: null,
  });

  await page.goto("/app/posta");
  await expect(page.getByRole("button", { name: "Propojit e-mail" })).toBeVisible();
});

test("podvržený návrat z Googlu nic nepřipojí", async ({ page }) => {
  const { userId } = await createSignedInUser(page.context());
  await page.goto("/onboarding");
  await completeOnboarding(page);

  await page.goto("/api/integrations/gmail/callback?code=ukradeny-kod&state=vymysleny-state");

  await expect(page).toHaveURL("/app/nastaveni?karta=propojeni&propojeni=neplatne&aplikace=gmail");
  expect(await storedMailbox(userId)).toBeNull();
  expect((await page.request.post("/api/integrations/gmail/connect")).status()).toBe(403);
});

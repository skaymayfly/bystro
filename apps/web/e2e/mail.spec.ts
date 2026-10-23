import type { MailMessage } from "@bystro/core";
import {
  createDb,
  listConnections,
  listOrganizationsForUser,
  readConnectionTokens,
  refreshMailThreads,
  upsertMailMessages,
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
  await expect(page.getByText("Gmail · petr@dvorak-interiery.cz", { exact: true })).toBeVisible();
  // Nothing synced yet (no worker in E2E): the first load is under way.
  await expect(page.getByRole("heading", { name: "Načítám poštu" })).toBeVisible();
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

/** What the worker would have stored after syncing; no worker runs in E2E. */
async function storeMail(userId: string, messages: MailMessage[]) {
  const { db, close } = createDb(readTestDatabase().url);
  try {
    const [membership] = await listOrganizationsForUser(db, userId);
    const organizationId = membership?.organization.id ?? "";
    const [connection] = (await listConnections(db, organizationId)).filter(
      (item) => item.provider === "gmail",
    );
    const scope = { organizationId, connectionId: connection?.id ?? "" };
    await upsertMailMessages(db, scope, messages, key);
    await refreshMailThreads(db, scope);
  } finally {
    await close();
  }
}

const mail = (id: string, overrides: Partial<MailMessage>): MailMessage => ({
  source: "gmail",
  externalId: id,
  threadExternalId: `thread-${id}`,
  historyId: null,
  receivedAt: new Date(Date.now() - 60 * 60 * 1000),
  labels: ["INBOX", "UNREAD"],
  from: { name: "Jana Nová", address: "jana@novak.example" },
  to: [{ name: "Petr Dvořák", address: "petr@dvorak-interiery.cz" }],
  cc: [],
  subject: "Zpráva",
  messageIdHeader: null,
  inReplyTo: null,
  references: [],
  snippet: "",
  bodyText: "",
  hasAttachments: false,
  ...overrides,
});

async function modifiedThreads(page: Page) {
  const response = await page.request.get(`${GOOGLE_STUB_URL}/__modified`);
  return ((await response.json()) as { threads: { id: string; removeLabelIds: string[] }[] })
    .threads;
}

test("Pošta: vlákno se otevře jako text bez HTML a archivace ho přesune i v Gmailu", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { userId } = await createSignedInUser(page.context());
  await page.goto("/onboarding");
  await completeOnboarding(page);
  await page.goto("/app/posta");
  await page.getByRole("button", { name: "Propojit e-mail" }).click();
  await expect(page.getByText("Gmail je propojený.")).toBeVisible();

  await storeMail(userId, [
    mail("faktura", {
      subject: "Faktura 2026-0142",
      snippet: "Dobrý den, posílám fakturu",
      bodyText:
        "Dobrý den,\n<b>tučně ne</b> <img src=x onerror=alert(1)>\nhttps://evil.example/platba",
      hasAttachments: true,
    }),
    mail("poptavka", {
      from: { name: "Pekárna U Mlýna", address: "info@pekarna.example" },
      subject: "Poptávka regálů",
      labels: ["INBOX"],
      receivedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    }),
    mail("odeslana", {
      from: { name: "Petr Dvořák", address: "petr@dvorak-interiery.cz" },
      to: [{ name: "Lenka Horáková", address: "lenka@horakova.example" }],
      subject: "Nabídka",
      labels: ["SENT"],
    }),
  ]);

  await page.goto("/app/posta");
  const threads = page.getByRole("list", { name: "Vlákna" });
  await expect(threads.getByRole("link")).toHaveCount(2);
  await expect(page.getByRole("link", { name: /Doručené/ })).toContainText("1");

  // Odeslané lists what was sent, named by its recipient.
  await page
    .getByRole("navigation", { name: "Složky pošty" })
    .getByRole("link", { name: "Odeslané" })
    .click();
  await expect(threads.getByRole("link")).toHaveCount(1);
  await expect(threads).toContainText("Lenka Horáková");
  await page
    .getByRole("navigation", { name: "Složky pošty" })
    .getByRole("link", { name: /Doručené/ })
    .click();

  // Search looks in subjects and names.
  await page.getByRole("searchbox", { name: "Hledat v poště" }).fill("pekárna");
  await page.keyboard.press("Enter");
  await expect(threads.getByRole("link")).toHaveCount(1);
  await expect(threads).toContainText("Poptávka regálů");
  await page.goto("/app/posta");

  // The mail is shown as text: the tags are visible characters, nothing is rendered.
  await threads.getByRole("link", { name: /Faktura 2026-0142/ }).click();
  await expect(page).toHaveURL("/app/posta?vlakno=thread-faktura");
  const messages = page.getByRole("list", { name: "Zprávy ve vláknu" });
  await expect(messages).toContainText("<b>tučně ne</b> <img src=x onerror=alert(1)>");
  await expect(messages.locator("b, img, a, script")).toHaveCount(0);
  await expect(messages).toContainText("Zpráva má přílohu");

  // Archiving: Gmail is told to take the thread out of INBOX, Bystro follows.
  await page.getByRole("button", { name: "Archivovat" }).click();
  await expect(page).toHaveURL("/app/posta");
  await expect(threads.getByRole("link")).toHaveCount(1);
  await expect(threads).not.toContainText("Faktura 2026-0142");
  expect(await modifiedThreads(page)).toContainEqual({
    id: "thread-faktura",
    removeLabelIds: ["INBOX"],
  });
});

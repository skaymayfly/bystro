import {
  createDb,
  listConnections,
  listOrganizationsForUser,
  readConnectionTokens,
} from "@bystro/db";
import { readTestDatabase } from "@bystro/db/testing";
import { expect, test, type Page } from "@playwright/test";

import { E2E_ENCRYPTION_KEY, FAKTUROID_STUB_URL } from "./config";
import { completeOnboarding, createSignedInUser, KNOWN_ICO } from "./helpers";

const key = Buffer.from(E2E_ENCRYPTION_KEY, "base64");

/** What the database of the server under test holds for the user's company. */
async function storedConnections(userId: string) {
  const { db, close } = createDb(readTestDatabase().url);
  try {
    const [membership] = await listOrganizationsForUser(db, userId);
    if (membership === undefined) {
      throw new Error("The test user has no company.");
    }
    const organizationId = membership.organization.id;
    const connections = await listConnections(db, organizationId);
    return await Promise.all(
      connections.map(async (connection) => ({
        status: connection.status,
        tokens: await readConnectionTokens(db, organizationId, connection.id, key),
      })),
    );
  } finally {
    await close();
  }
}

async function connectionsFromApi(page: Page) {
  const response = await page.request.get("/api/integrations/connections");
  expect(response.status()).toBe(200);
  return ((await response.json()) as { connections: { id: string; status: string }[] }).connections;
}

async function revocations(page: Page): Promise<number> {
  const response = await page.request.get(`${FAKTUROID_STUB_URL}/__revocations`);
  return ((await response.json()) as { count: number }).count;
}

test("připojení Fakturoidu → stav → odpojení; po odpojení nejsou v databázi tokeny", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { userId } = await createSignedInUser(page.context());
  await page.goto("/onboarding");
  await completeOnboarding(page);

  // Other screens lead to the connection instead of saying "Připravujeme".
  await page.goto("/app/faktury");
  await page.getByRole("link", { name: "Připojit fakturaci" }).click();
  await expect(page).toHaveURL("/app/nastaveni?karta=propojeni");
  await expect(page.getByText("Zatím nic. Vyber aplikaci vlevo.")).toBeVisible();
  await expect(page.getByText("Právo číst faktury a kontakty")).toBeVisible();
  const revokedBefore = await revocations(page);

  // Off to (the stand-in for) Fakturoid and back.
  await page.getByRole("button", { name: "Propojit" }).click();
  await expect(page).toHaveURL("/app/nastaveni?karta=propojeni&propojeni=ok");
  await expect(
    page.getByText("Fakturoid je propojený. Faktury načtu během chvilky."),
  ).toBeVisible();

  // The connected app with its state; no worker runs in E2E, so it waits for the first load.
  await expect(page.getByText("1 z 14")).toBeVisible();
  await expect(page.getByText("Fakturace · Alexandr Hejsek")).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Čekám na první načtení" }),
  ).toBeVisible();
  // Connected once: the offer to connect is gone.
  await expect(page.getByRole("button", { name: "Propojit" })).toHaveCount(0);

  // The tokens are in the database (encrypted), and nowhere in what the browser received.
  const connected = await storedConnections(userId);
  expect(connected.map((connection) => connection.status)).toEqual(["connected"]);
  expect(connected[0]?.tokens?.accessToken.reveal()).toBe("stub-access-token");
  expect(await page.content()).not.toMatch(/stub-access-token|stub-refresh-token/);
  const fromApi = await connectionsFromApi(page);
  expect(fromApi.map((connection) => connection.status)).toEqual(["connected"]);
  expect(JSON.stringify(fromApi)).not.toMatch(/token/i);

  await page.goto("/app/faktury");
  await expect(page.getByText("Fakturace je propojená")).toBeVisible();

  await page.goto("/app/nastaveni?karta=propojeni");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Odpojit" }).click();
  await expect(page.getByText("Zatím nic. Vyber aplikaci vlevo.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Propojit" })).toBeVisible();

  expect(await connectionsFromApi(page)).toEqual([]);
  expect(await revocations(page)).toBe(revokedBefore + 1);
  // After disconnecting, the database holds no tokens.
  expect(await storedConnections(userId)).toEqual([{ status: "revoked", tokens: null }]);
});

test("onboarding nabídne Fakturoid a po připojení pokračuje dál", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createSignedInUser(page.context());
  await page.goto("/onboarding");
  await page.getByLabel("IČO").fill(KNOWN_ICO);
  await page.getByRole("button", { name: "Dohledat v ARES" }).click();
  await expect(page.getByLabel("Název firmy")).not.toHaveValue("");
  await page.getByRole("button", { name: "Pokračovat" }).click();
  await expect(page).toHaveURL("/onboarding?krok=2");

  await expect(page.getByRole("link", { name: "Teď přeskočit" })).toBeVisible();
  await page.getByRole("button", { name: "Propojit" }).click();

  await expect(page).toHaveURL("/onboarding?krok=2&propojeni=ok");
  await expect(page.getByText("Fakturoid je propojený!")).toBeVisible();
  await page.getByRole("link", { name: "Pokračovat" }).click();
  await expect(page).toHaveURL("/onboarding?krok=3");
});

test("podvržený návrat z Fakturoidu nic nepřipojí", async ({ page }) => {
  const { userId } = await createSignedInUser(page.context());
  await page.goto("/onboarding");
  await completeOnboarding(page);

  await page.goto("/api/integrations/fakturoid/callback?code=ukradeny-kod&state=vymysleny-state");
  await expect(page).toHaveURL("/app/nastaveni?karta=propojeni&propojeni=neplatne");
  await expect(page.getByText("Tenhle odkaz už neplatí. Zkus to prosím znovu.")).toBeVisible();
  expect(await storedConnections(userId)).toEqual([]);
});

test("cesty propojení chrání přihlášení, původ požadavku a cizí data", async ({
  page,
  request,
  baseURL,
}) => {
  const id = "0b0e8a52-5f0c-4d6e-9d57-0e6f0a5f3c11";
  // Without a session.
  expect((await request.get("/api/integrations/connections")).status()).toBe(401);
  expect((await request.post(`/api/integrations/connections/${id}/disconnect`)).status()).toBe(401);
  expect((await request.post("/api/integrations/fakturoid/connect")).status()).toBe(401);

  await createSignedInUser(page.context());
  await page.goto("/onboarding");
  await completeOnboarding(page);
  const sameOrigin = { origin: baseURL as string };

  // From another site, even with a valid session.
  for (const path of [
    "/api/integrations/fakturoid/connect",
    `/api/integrations/connections/${id}/sync`,
    `/api/integrations/connections/${id}/disconnect`,
    `/api/integrations/connections/${id}/account`,
  ]) {
    const crossSite = await page.request.post(path, {
      headers: { origin: "https://evil.example" },
      maxRedirects: 0,
    });
    expect(crossSite.status(), path).toBe(403);
  }

  // A connection that does not exist in this company, and an id that is not an id.
  for (const action of ["sync", "disconnect"]) {
    const unknown = await page.request.post(`/api/integrations/connections/${id}/${action}`, {
      headers: sameOrigin,
    });
    expect(unknown.status(), action).toBe(404);
  }
  const malformed = await page.request.post("/api/integrations/connections/neni-id/sync", {
    headers: sameOrigin,
  });
  expect(malformed.status()).toBe(404);
});

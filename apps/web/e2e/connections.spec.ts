import {
  createDb,
  listConnections,
  listOrganizationsForUser,
  readConnectionTokens,
} from "@bystro/db";
import { readTestDatabase } from "@bystro/db/testing";
import { expect, test, type Page } from "@playwright/test";

import { E2E_ENCRYPTION_KEY, FAKTUROID_STUB_URL, IDOKLAD_STUB_URL } from "./config";
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
        provider: connection.provider,
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

async function revocations(page: Page, stubUrl = FAKTUROID_STUB_URL): Promise<number> {
  const response = await page.request.get(`${stubUrl}/__revocations`);
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
  const revokedBefore = await revocations(page);

  // The panel is closed until the Fakturoid tile is clicked; the note about Fakturoid
  // being a separate paid service belongs to it, not to all the tiles.
  const tile = page.getByRole("button", { name: "Fakturoid", exact: true });
  await expect(page.getByRole("button", { name: "Propojit" })).toHaveCount(0);
  await expect(page.getByText("Fakturoid je samostatná placená služba")).toHaveCount(0);
  await expect(page.getByText("Klikni na aplikaci a uvidíš, co je potřeba.")).toBeVisible();
  await tile.click();
  await expect(tile).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Právo číst faktury a kontakty")).toBeVisible();
  await expect(page.getByText("Fakturoid je samostatná placená služba")).toBeVisible();
  // A second click closes it again.
  await tile.click();
  await expect(page.getByRole("button", { name: "Propojit" })).toHaveCount(0);
  await tile.click();

  // Off to (the stand-in for) Fakturoid and back.
  await page.getByRole("button", { name: "Propojit" }).click();
  await expect(page).toHaveURL("/app/nastaveni?karta=propojeni&propojeni=ok&aplikace=fakturoid");
  await expect(
    page.getByText("Fakturoid je propojený. Faktury načtu během chvilky."),
  ).toBeVisible();

  // The connected app with its state; no worker runs in E2E, so it waits for the first load.
  await expect(page.getByText("1 z 14")).toBeVisible();
  await expect(page.getByText("Fakturace · Alexandr Hejsek")).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Čekám na první načtení" }),
  ).toBeVisible();
  // Connected once: the tile no longer offers to connect.
  await page.getByRole("button", { name: "Fakturoid", exact: true }).click();
  await expect(page.getByText("Fakturoid je propojený. Stav a odpojení najdeš")).toBeVisible();
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
  await expect(page.getByText("Faktury se načítají")).toBeVisible();

  await page.goto("/app/nastaveni?karta=propojeni");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Odpojit" }).click();
  await expect(page.getByText("Zatím nic. Vyber aplikaci vlevo.")).toBeVisible();
  await page.getByRole("button", { name: "Fakturoid", exact: true }).click();
  await expect(page.getByRole("button", { name: "Propojit" })).toBeVisible();

  expect(await connectionsFromApi(page)).toEqual([]);
  expect(await revocations(page)).toBe(revokedBefore + 1);
  // After disconnecting, the database holds no tokens.
  expect(await storedConnections(userId)).toEqual([
    { provider: "fakturoid", status: "revoked", tokens: null },
  ]);
});

test("iDoklad jde připojit vedle Fakturoidu a odpojit zvlášť", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { userId } = await createSignedInUser(page.context());
  await page.goto("/onboarding");
  await completeOnboarding(page);
  await page.goto("/app/nastaveni?karta=propojeni");

  // iDoklad has its own panel with its own requirements and note.
  const tile = page.getByRole("button", { name: "iDoklad", exact: true });
  await tile.click();
  await expect(page.getByText("Tarif iDokladu, který dovoluje přístup přes API")).toBeVisible();
  await expect(page.getByText("iDoklad je samostatná služba")).toBeVisible();
  await expect(page.getByText("Fakturoid je samostatná placená služba")).toHaveCount(0);
  // Nothing else is connected, so there is nothing to warn about.
  await expect(page.getByText("počítal dvakrát")).toHaveCount(0);

  // Off to (the stand-in for) iDoklad and back. Like the real server, the stand-in gives
  // tokens only once per code and refuses a request with a PKCE verifier.
  await page.getByRole("button", { name: "Propojit" }).click();
  await expect(page).toHaveURL("/app/nastaveni?karta=propojeni&propojeni=ok&aplikace=idoklad");
  await expect(page.getByText("iDoklad je propojený. Faktury načtu během chvilky.")).toBeVisible();
  await expect(page.getByText("1 z 14")).toBeVisible();
  await expect(page.getByText("Fakturace · Malíři Hejsek")).toBeVisible();
  expect(await page.content()).not.toMatch(/stub-idoklad-access-token|stub-idoklad-refresh-token/);

  await page.goto("/app/faktury");
  await expect(page.getByText("iDoklad je propojený", { exact: true })).toBeVisible();
  await expect(page.getByText("Zdroj: iDoklad")).toBeVisible();

  // Connecting Fakturoid as well is allowed, with a warning about invoices kept in both.
  await page.goto("/app/nastaveni?karta=propojeni");
  await page.getByRole("button", { name: "Fakturoid", exact: true }).click();
  await expect(page.getByText("Už máš propojený iDoklad.")).toBeVisible();
  await expect(page.getByText("počítal dvakrát")).toBeVisible();
  await page.getByRole("button", { name: "Propojit" }).click();
  await expect(page).toHaveURL("/app/nastaveni?karta=propojeni&propojeni=ok&aplikace=fakturoid");
  await expect(page.getByText("2 z 14")).toBeVisible();

  const both = await storedConnections(userId);
  expect(both.map((connection) => [connection.provider, connection.status]).sort()).toEqual([
    ["fakturoid", "connected"],
    ["idoklad", "connected"],
  ]);
  const idoklad = both.find((connection) => connection.provider === "idoklad");
  expect(idoklad?.tokens?.accessToken.reveal()).toBe("stub-idoklad-access-token");
  expect(idoklad?.tokens?.refreshToken?.reveal()).toBe("stub-idoklad-refresh-token");

  await page.goto("/app/faktury");
  await expect(page.getByText("Fakturoid a iDoklad jsou propojené", { exact: true })).toBeVisible();
  await expect(page.getByText("Zdroj: Fakturoid a iDoklad")).toBeVisible();

  // Disconnecting iDoklad revokes it there and leaves Fakturoid alone.
  await page.goto("/app/nastaveni?karta=propojeni");
  const revokedBefore = await revocations(page, IDOKLAD_STUB_URL);
  const fakturoidRevokedBefore = await revocations(page);
  page.once("dialog", (dialog) => void dialog.accept());
  await page
    .getByRole("listitem")
    .filter({ hasText: "Malíři Hejsek" })
    .getByRole("button", { name: "Odpojit" })
    .click();
  await expect(page.getByText("1 z 14")).toBeVisible();
  await expect(page.getByText("Fakturace · Malíři Hejsek")).toHaveCount(0);

  expect(await revocations(page, IDOKLAD_STUB_URL)).toBe(revokedBefore + 1);
  expect(await revocations(page)).toBe(fakturoidRevokedBefore);
  const after = await storedConnections(userId);
  expect(after.find((connection) => connection.provider === "idoklad")).toEqual({
    provider: "idoklad",
    status: "revoked",
    tokens: null,
  });
  expect(after.find((connection) => connection.provider === "fakturoid")?.status).toBe("connected");
});

test("podvržený návrat z iDokladu nic nepřipojí", async ({ page }) => {
  const { userId } = await createSignedInUser(page.context());
  await page.goto("/onboarding");
  await completeOnboarding(page);

  await page.goto("/api/integrations/idoklad/callback?code=ukradeny-kod&state=vymysleny-state");

  await expect(page).toHaveURL(
    "/app/nastaveni?karta=propojeni&propojeni=neplatne&aplikace=idoklad",
  );
  await expect(page.getByText("Tenhle odkaz už neplatí. Zkus to prosím znovu.")).toBeVisible();
  expect(await storedConnections(userId)).toEqual([]);
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
  await expect(page.getByRole("button", { name: "Propojit" })).toHaveCount(0);
  await page.getByRole("button", { name: "Fakturoid", exact: true }).click();
  await page.getByRole("button", { name: "Propojit" }).click();

  await expect(page).toHaveURL("/onboarding?krok=2&propojeni=ok&aplikace=fakturoid");
  await expect(page.getByText("Fakturoid je propojený!")).toBeVisible();
  await page.getByRole("link", { name: "Pokračovat" }).click();
  await expect(page).toHaveURL("/onboarding?krok=3");
});

test("podvržený návrat z Fakturoidu nic nepřipojí", async ({ page }) => {
  const { userId } = await createSignedInUser(page.context());
  await page.goto("/onboarding");
  await completeOnboarding(page);

  await page.goto("/api/integrations/fakturoid/callback?code=ukradeny-kod&state=vymysleny-state");
  await expect(page).toHaveURL(
    "/app/nastaveni?karta=propojeni&propojeni=neplatne&aplikace=fakturoid",
  );
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
  expect((await request.post("/api/integrations/idoklad/connect")).status()).toBe(401);

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

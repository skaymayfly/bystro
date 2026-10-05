import { expect, test } from "@playwright/test";

import { newEmail, signIn, signUp } from "./helpers";

// Sign-up and sign-in are rate limited in production mode, so the tests share one account.
test.describe.configure({ mode: "serial" });
const email = newEmail();

test("registrace → odhlášení → přihlášení", async ({ page }) => {
  await page.goto("/registrace");
  await expect(page.getByRole("heading", { name: "Začni zdarma na 30 dní" })).toBeVisible();
  await signUp(page, email);
  await expect(
    page.getByRole("heading", { name: "Ahoj! Jak se jmenuje tvoje firma?" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Odhlásit se" }).click();
  await expect(page).toHaveURL("/prihlaseni");

  // After signing out the app is closed again.
  await page.goto("/app");
  await expect(page).toHaveURL(/\/prihlaseni\?next=%2Fapp$/);

  await expect(page.getByRole("heading", { name: "Vítej zpátky" })).toBeVisible();
  await signIn(page, email);

  // Signed in again; still no company, so onboarding comes first.
  await expect(page).toHaveURL("/onboarding");
});

test("špatné heslo ukáže chybu a nepřihlásí", async ({ page }) => {
  await page.goto("/prihlaseni");
  await signIn(page, email, "uplne-jine-heslo");

  await expect(page.getByText("E-mail nebo heslo nesedí.")).toBeVisible();
  await expect(page).toHaveURL("/prihlaseni");
});

test("nepřihlášený uživatel je z /app přesměrován na přihlášení", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/prihlaseni\?next=%2Fapp$/);
  await expect(page.getByRole("heading", { name: "Vítej zpátky" })).toBeVisible();
});

test("podvržená session cookie do aplikace nepustí", async ({ page, context, baseURL }) => {
  // The proxy only checks that a cookie exists; the server must still validate the session.
  await context.addCookies([
    { name: "better-auth.session_token", value: "forged.value", url: baseURL as string },
  ]);

  for (const path of ["/app", "/onboarding"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/prihlaseni/);
  }
  await expect(page.getByRole("heading", { name: "Vítej zpátky" })).toBeVisible();
});

test("tlačítko Google se bez nastavených klíčů nezobrazí", async ({ page }) => {
  await page.goto("/prihlaseni");
  await expect(page.getByRole("button", { name: "Přihlásit se" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pokračovat přes Google" })).toHaveCount(0);
});

test("API bez přihlášení vrací 401, přihlašovací API je veřejné", async ({ request, baseURL }) => {
  expect((await request.get("/api/cokoli")).status()).toBe(401);
  expect((await request.get("/api/companies/lookup?ico=27074358")).status()).toBe(401);
  const create = await request.post("/api/organizations", {
    headers: { origin: baseURL as string },
    data: { name: "Firma", ico: "27074358" },
  });
  expect(create.status()).toBe(401);

  expect((await request.get("/api/auth/get-session")).status()).toBe(200);
});

test("zapomenuté heslo odpoví stejně pro neznámý e-mail", async ({ page }) => {
  await page.goto("/prihlaseni");
  await page.getByRole("link", { name: "Nepamatuju si heslo" }).click();
  await expect(page).toHaveURL("/zapomenute-heslo");

  await page.getByLabel("E-mail").fill(newEmail());
  await page.getByRole("button", { name: "Poslat odkaz" }).click();

  await expect(page.getByText("Pokud u nás máš účet")).toBeVisible();
});

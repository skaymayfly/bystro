import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

const PASSWORD = "tajne-heslo-123";
const newEmail = () => `e2e-${randomUUID()}@example.test`;

test("registrace → odhlášení → přihlášení", async ({ page }) => {
  const email = newEmail();

  await page.goto("/registrace");
  await expect(page.getByRole("heading", { name: "Začni zdarma na 30 dní" })).toBeVisible();
  await page.getByLabel("Jméno a příjmení").fill("Petr Dvořák");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Heslo").fill(PASSWORD);
  await page.getByRole("button", { name: "Vytvořit účet" }).click();

  await expect(page).toHaveURL("/app");
  await expect(page.getByRole("heading", { name: "Ahoj, Petr Dvořák" })).toBeVisible();

  await page.getByRole("button", { name: "Odhlásit se" }).click();
  await expect(page).toHaveURL("/prihlaseni");

  // After signing out the app is closed again.
  await page.goto("/app");
  await expect(page).toHaveURL(/\/prihlaseni\?next=%2Fapp$/);

  await expect(page.getByRole("heading", { name: "Vítej zpátky" })).toBeVisible();
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Heslo").fill(PASSWORD);
  await page.getByRole("button", { name: "Přihlásit se" }).click();

  await expect(page).toHaveURL("/app");
  await expect(page.getByRole("heading", { name: "Ahoj, Petr Dvořák" })).toBeVisible();
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

  await page.goto("/app");
  await expect(page).toHaveURL(/\/prihlaseni/);
  await expect(page.getByRole("heading", { name: "Vítej zpátky" })).toBeVisible();
});

test("špatné heslo ukáže chybu a nepřihlásí", async ({ page }) => {
  const email = newEmail();
  await page.goto("/registrace");
  await page.getByLabel("Jméno a příjmení").fill("Jana Nováková");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Heslo").fill(PASSWORD);
  await page.getByRole("button", { name: "Vytvořit účet" }).click();
  await expect(page).toHaveURL("/app");
  await page.getByRole("button", { name: "Odhlásit se" }).click();
  await expect(page).toHaveURL("/prihlaseni");

  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Heslo").fill("uplne-jine-heslo");
  await page.getByRole("button", { name: "Přihlásit se" }).click();

  await expect(page.getByText("E-mail nebo heslo nesedí.")).toBeVisible();
  await expect(page).toHaveURL("/prihlaseni");
});

test("tlačítko Google se bez nastavených klíčů nezobrazí", async ({ page }) => {
  await page.goto("/prihlaseni");
  await expect(page.getByRole("button", { name: "Přihlásit se" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pokračovat přes Google" })).toHaveCount(0);
});

test("API bez přihlášení vrací 401, přihlašovací API je veřejné", async ({ request }) => {
  const privateRoute = await request.get("/api/cokoli");
  expect(privateRoute.status()).toBe(401);

  const session = await request.get("/api/auth/get-session");
  expect(session.status()).toBe(200);
});

test("zapomenuté heslo odpoví stejně pro neznámý e-mail", async ({ page }) => {
  await page.goto("/prihlaseni");
  await page.getByRole("link", { name: "Nepamatuju si heslo" }).click();
  await expect(page).toHaveURL("/zapomenute-heslo");

  await page.getByLabel("E-mail").fill(newEmail());
  await page.getByRole("button", { name: "Poslat odkaz" }).click();

  await expect(page.getByText("Pokud u nás máš účet")).toBeVisible();
});

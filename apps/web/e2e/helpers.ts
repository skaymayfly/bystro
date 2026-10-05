import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";

export const PASSWORD = "tajne-heslo-123";
export const newEmail = () => `e2e-${randomUUID()}@example.test`;

/** IČO the ARES stub knows (see e2e/ares-stub.mjs). */
export const KNOWN_ICO = "27074358";
export const KNOWN_COMPANY_NAME = "Asseco Central Europe, a.s.";
/** Valid IČO the stub answers with "not found". */
export const UNKNOWN_ICO = "99999994";
/** Valid IČO for which the stub pretends ARES is down. */
export const OUTAGE_ICO = "45274649";

/** Registers a new user; they land on onboarding because they have no company yet. */
export async function signUp(page: Page, email: string, name = "Petr Dvořák") {
  await page.goto("/registrace");
  await page.getByLabel("Jméno a příjmení").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Heslo").fill(PASSWORD);
  await page.getByRole("button", { name: "Vytvořit účet" }).click();
  await expect(page).toHaveURL("/onboarding");
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Heslo").fill(password);
  await page.getByRole("button", { name: "Přihlásit se" }).click();
}

/** Walks through onboarding with the company the ARES stub knows and ends on Přehled. */
export async function completeOnboarding(page: Page) {
  await page.getByLabel("IČO").fill(KNOWN_ICO);
  await page.getByRole("button", { name: "Dohledat v ARES" }).click();
  await expect(page.getByLabel("Název firmy")).toHaveValue(KNOWN_COMPANY_NAME);
  await page.getByRole("button", { name: "Pokračovat" }).click();
  await expect(page).toHaveURL("/onboarding?krok=2");
  await page.getByRole("link", { name: "Teď přeskočit" }).click();
  await expect(page).toHaveURL("/onboarding?krok=3");
  await page.getByRole("link", { name: "Začít používat" }).click();
  await expect(page).toHaveURL("/app");
}

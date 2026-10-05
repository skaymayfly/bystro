import { randomUUID } from "node:crypto";

import { createDb } from "@bystro/db";
import { readTestDatabase } from "@bystro/db/testing";
import { FakeEmailSender } from "@bystro/integrations/testing";
import { createLogger } from "@bystro/observability";
import { expect, type BrowserContext, type Page } from "@playwright/test";

import { createAuth } from "../src/server/auth-config";
import { E2E_AUTH_SECRET, E2E_BASE_URL } from "./config";

export const PASSWORD = "tajne-heslo-123";
export const newEmail = () => `e2e-${randomUUID()}@example.test`;

/** IČO the ARES stub knows (see e2e/ares-stub.mjs). */
export const KNOWN_ICO = "27074358";
export const KNOWN_COMPANY_NAME = "Asseco Central Europe, a.s.";
/** Valid IČO the stub answers with "not found". */
export const UNKNOWN_ICO = "99999994";
/** Valid IČO for which the stub pretends ARES is down. */
export const OUTAGE_ICO = "45274649";

/**
 * Creates a user directly on the server and signs the browser context in as them.
 *
 * Sign-up and sign-in over HTTP are rate limited in production mode (3 per 10 s), so only
 * the tests that are about those forms go through the UI; everything else starts here.
 * The session is real: same database, same auth configuration, same signing secret as the
 * server under test.
 */
export async function createSignedInUser(
  context: BrowserContext,
  options: { name?: string } = {},
): Promise<{ email: string }> {
  const email = newEmail();
  const { db, close } = createDb(readTestDatabase().url);
  try {
    const auth = createAuth({
      db,
      emailSender: new FakeEmailSender(),
      env: { secret: E2E_AUTH_SECRET, baseUrl: E2E_BASE_URL },
      logger: createLogger({ service: "e2e", level: "silent" }),
    });
    const response = await auth.api.signUpEmail({
      body: { name: options.name ?? "Petr Dvořák", email, password: PASSWORD },
      asResponse: true,
    });
    expect(response.ok, "server-side sign-up for the test user").toBe(true);

    const cookies = response.headers.getSetCookie().map((header) => {
      const [pair = ""] = header.split(";");
      const separator = pair.indexOf("=");
      return {
        name: pair.slice(0, separator),
        value: pair.slice(separator + 1),
        url: E2E_BASE_URL,
      };
    });
    await context.addCookies(cookies);
  } finally {
    await close();
  }
  return { email };
}

/** Registers through the sign-up form; the new user lands on onboarding (no company yet). */
export async function signUp(page: Page, email: string, name = "Petr Dvořák") {
  await page.goto("/registrace");
  await page.getByLabel("Jméno a příjmení").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Heslo").fill(PASSWORD);
  await page.getByRole("button", { name: "Vytvořit účet" }).click();
  await expect(page).toHaveURL("/onboarding");
}

/** Fills and submits the sign-in form on the current page. */
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

import { expect, test } from "@playwright/test";

import {
  createSignedInUser,
  KNOWN_COMPANY_NAME,
  KNOWN_ICO,
  OUTAGE_ICO,
  UNKNOWN_ICO,
} from "./helpers";

test.describe.configure({ mode: "serial" });

test("registrace → zadání IČO → firma založena → Přehled", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await createSignedInUser(page.context());

  // The app itself is closed until a company exists.
  await page.goto("/app/faktury");
  await expect(page).toHaveURL("/onboarding");
  await expect(page.getByRole("heading", { name: "Jak se jmenuje tvoje firma?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pokračovat" })).toBeDisabled();

  // A typo is caught before anything is sent to ARES.
  await page.getByLabel("IČO").fill("27074359");
  await page.getByRole("button", { name: "Dohledat v ARES" }).click();
  await expect(page.getByText("IČO má 8 číslic. Tohle nevypadá správně.")).toBeVisible();

  // The real IČO, typed with spaces, is found and the form is prefilled.
  await page.getByLabel("IČO").fill("270 74 358");
  await page.getByRole("button", { name: "Dohledat v ARES" }).click();
  await expect(page.getByText("Našlo se v ARES.")).toBeVisible();
  await expect(page.getByLabel("IČO")).toHaveValue(KNOWN_ICO);
  await expect(page.getByLabel("Název firmy")).toHaveValue(KNOWN_COMPANY_NAME);
  await expect(page.getByLabel("DIČ")).toHaveValue("CZ27074358");
  await expect(page.getByLabel("Ulice a číslo")).toHaveValue("Budějovická 778/3a");
  await expect(page.getByLabel("Město")).toHaveValue("Praha");
  await expect(page.getByLabel("PSČ")).toHaveValue("14000");
  await expect(page.getByLabel("Jsme plátci DPH")).toBeChecked();

  // The user may correct what ARES returned.
  await page.getByLabel("Název firmy").fill("Dvořák Interiéry s.r.o.");
  await page.getByRole("button", { name: "Pokračovat" }).click();

  await expect(page).toHaveURL("/onboarding?krok=2");
  await expect(page.getByRole("heading", { name: "Co mám propojit?" })).toBeVisible();
  await page.getByRole("link", { name: "Teď přeskočit" }).click();

  await expect(page).toHaveURL("/onboarding?krok=3");
  await expect(page.getByRole("heading", { name: "Kdy ti mám posílat přehled?" })).toBeVisible();
  await page.getByRole("link", { name: "Začít používat" }).click();

  await expect(page).toHaveURL("/app");
  await expect(page.getByRole("complementary").getByText("Dvořák Interiéry s.r.o.")).toBeVisible();
  await expect(page.getByText("Faktury zatím nevidím")).toBeVisible();

  // Onboarding step 1 is over for good; a second company cannot be created.
  await page.goto("/onboarding");
  await expect(page).toHaveURL("/app");
  const second = await page.request.post("/api/organizations", {
    headers: { origin: baseURL as string },
    data: { name: "Druhá firma", ico: KNOWN_ICO },
  });
  expect(second.status()).toBe(409);
});

test("když ARES firmu nenajde nebo neodpovídá, jde údaje vyplnit ručně", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createSignedInUser(page.context(), { name: "Jana Nováková" });
  await page.goto("/onboarding");

  await page.getByLabel("IČO").fill(UNKNOWN_ICO);
  await page.getByRole("button", { name: "Dohledat v ARES" }).click();
  await expect(page.getByText("Tohle IČO v ARES není.")).toBeVisible();
  await expect(page.getByLabel("Název firmy")).toHaveValue("");

  // Changing the IČO hides the details until it is looked up again.
  await page.getByLabel("IČO").fill(OUTAGE_ICO);
  await expect(page.getByLabel("Název firmy")).toHaveCount(0);
  await page.getByRole("button", { name: "Dohledat v ARES" }).click();
  await expect(page.getByText("ARES teď neodpovídá. Vyplň údaje ručně.")).toBeVisible();

  // The server validates too: a bad PSČ is rejected with a readable message.
  await page.getByLabel("Název firmy").fill("Truhlářství Nováková");
  await page.getByLabel("PSČ").fill("12");
  await page.getByRole("button", { name: "Pokračovat" }).click();
  await expect(page.getByText("Zkontroluj prosím: PSČ.")).toBeVisible();
  await expect(page).toHaveURL("/onboarding");

  await page.getByLabel("PSČ").fill("602 00");
  await page.getByLabel("Město").fill("Brno");
  await page.getByRole("button", { name: "Pokračovat" }).click();
  await expect(page).toHaveURL("/onboarding?krok=2");

  await page.goto("/app");
  await expect(page).toHaveURL("/app");
  await expect(page.getByText("Faktury zatím nevidím")).toBeVisible();

  // Requests from another site are refused even with a valid session.
  const crossSite = await page.request.post("/api/organizations", {
    headers: { origin: "https://evil.example" },
    data: { name: "Podvržená firma", ico: KNOWN_ICO },
  });
  expect(crossSite.status()).toBe(403);
});

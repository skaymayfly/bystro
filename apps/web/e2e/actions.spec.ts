import { expect, test } from "@playwright/test";

import { completeOnboarding, createSignedInUser } from "./helpers";

test("schvalování akcí chrání přihlášení, původ požadavku a cizí data", async ({
  page,
  request,
  baseURL,
}) => {
  const id = "0b0e8a52-5f0c-4d6e-9d57-0e6f0a5f3c11";
  const approval = { approval: true };

  // Without a session.
  expect((await request.post(`/api/v1/actions/${id}/approve`, { data: approval })).status()).toBe(
    401,
  );
  expect((await request.post(`/api/v1/actions/${id}/reject`)).status()).toBe(401);

  await createSignedInUser(page.context());
  await page.goto("/onboarding");
  await completeOnboarding(page);
  const sameOrigin = { origin: baseURL as string };

  // From another site, even with a valid session.
  for (const action of ["approve", "reject"]) {
    const crossSite = await page.request.post(`/api/v1/actions/${id}/${action}`, {
      headers: { origin: "https://evil.example" },
      data: approval,
    });
    expect(crossSite.status(), action).toBe(403);
  }

  // The body the contract asks for.
  for (const data of [{}, { approval: false }, { approval: "true" }]) {
    const invalid = await page.request.post(`/api/v1/actions/${id}/approve`, {
      headers: sameOrigin,
      data,
    });
    expect(invalid.status(), JSON.stringify(data)).toBe(400);
  }

  // An action that does not exist in this company, and an id that is not an id.
  for (const action of ["approve", "reject"]) {
    const unknown = await page.request.post(`/api/v1/actions/${id}/${action}`, {
      headers: sameOrigin,
      data: approval,
    });
    expect(unknown.status(), action).toBe(404);
    expect(await unknown.json()).toEqual({ error: "not_found" });
  }
  const malformed = await page.request.post("/api/v1/actions/neni-id/approve", {
    headers: sameOrigin,
    data: approval,
  });
  expect(malformed.status()).toBe(404);
});

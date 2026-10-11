import { Secret } from "@bystro/core";
import type { IntegrationConnection } from "@bystro/db";
import { describe, expect, it } from "vitest";

import { createInvoiceProviderResolver, type ProviderSettings } from "./providers";

const settings: ProviderSettings = {
  fakturoid: {
    clientId: "fakturoid-id",
    clientSecret: new Secret("fakturoid-secret"),
    userAgent: "Bystro (vyvoj@bystro.example)",
  },
  idoklad: { clientId: "idoklad-id", clientSecret: new Secret("idoklad-secret") },
};

const connection = (provider: string, externalAccountId: string | null) =>
  ({ provider, externalAccountId }) as IntegrationConnection;

const tokens = { accessToken: new Secret("access"), refreshToken: null, expiresAt: null };

describe("createInvoiceProviderResolver", () => {
  it("sets up Fakturoid for the account of the connection", () => {
    const setup = createInvoiceProviderResolver(settings)(connection("fakturoid", "applecorp"));

    expect(setup?.oauth?.id).toBe("fakturoid");
    expect(setup?.rateLimit).toEqual({
      key: "fakturoid.applecorp",
      limit: { max: 400, windowMs: 60_000 },
    });
    expect(setup?.create(tokens).source).toBe("fakturoid");
  });

  it("sets up iDoklad for the agenda of the connection", () => {
    const setup = createInvoiceProviderResolver(settings)(connection("idoklad", "4321"));

    expect(setup?.oauth?.id).toBe("idoklad");
    expect(setup?.oauth?.pkce).toBe("none");
    expect(setup?.rateLimit).toEqual({
      key: "idoklad.4321",
      limit: { max: 200, windowMs: 60_000 },
    });
    expect(setup?.create(tokens).source).toBe("idoklad");
  });

  it("gives nothing for a provider that is not configured, has no account or is unknown", () => {
    const none = createInvoiceProviderResolver({ fakturoid: null, idoklad: null });
    expect(none(connection("fakturoid", "applecorp"))).toBeNull();
    expect(none(connection("idoklad", "4321"))).toBeNull();

    const resolve = createInvoiceProviderResolver(settings);
    expect(resolve(connection("fakturoid", null))).toBeNull();
    expect(resolve(connection("idoklad", null))).toBeNull();
    expect(resolve(connection("pohoda", "x"))).toBeNull();
  });
});

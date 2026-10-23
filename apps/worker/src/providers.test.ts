import { Secret } from "@bystro/core";
import type { IntegrationConnection } from "@bystro/db";
import { describe, expect, it } from "vitest";

import {
  createInvoiceProviderResolver,
  createMailboxResolver,
  type ProviderSettings,
} from "./providers";

const settings: ProviderSettings = {
  fakturoid: {
    clientId: "fakturoid-id",
    clientSecret: new Secret("fakturoid-secret"),
    userAgent: "Bystro (vyvoj@bystro.example)",
  },
  idoklad: { clientId: "idoklad-id", clientSecret: new Secret("idoklad-secret") },
  gmail: { clientId: "gmail-id", clientSecret: new Secret("gmail-secret") },
};

const connection = (provider: string, externalAccountId: string | null) =>
  ({
    provider,
    externalAccountId,
    id: "0b9f7f2e-3a8c-4d6e-9f5b-2c1d4e6f8a90",
  }) as IntegrationConnection;

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
    const none = createInvoiceProviderResolver({ fakturoid: null, idoklad: null, gmail: null });
    expect(none(connection("fakturoid", "applecorp"))).toBeNull();
    expect(none(connection("idoklad", "4321"))).toBeNull();

    const resolve = createInvoiceProviderResolver(settings);
    expect(resolve(connection("fakturoid", null))).toBeNull();
    expect(resolve(connection("idoklad", null))).toBeNull();
    expect(resolve(connection("pohoda", "x"))).toBeNull();
  });
});

describe("createMailboxResolver", () => {
  it("sets up Gmail with its quota counted per mailbox, in quota units", () => {
    const setup = createMailboxResolver(settings)(connection("gmail", "petr@dvorak.test"));

    expect(setup?.oauth?.id).toBe("gmail");
    expect(setup?.rateLimit).toEqual({
      key: "gmail.0b9f7f2e-3a8c-4d6e-9f5b-2c1d4e6f8a90",
      limit: { max: 6_000, windowMs: 60_000 },
    });
    expect(setup?.create(tokens, async () => {}).source).toBe("gmail");
  });

  it("gives nothing for other providers or when Gmail is not configured here", () => {
    expect(createMailboxResolver(settings)(connection("fakturoid", "x"))).toBeNull();
    expect(createMailboxResolver({ gmail: null })(connection("gmail", "x"))).toBeNull();
  });
});

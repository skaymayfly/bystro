import { rateLimitKey, type Secret } from "@bystro/core";
import {
  FAKTUROID_RATE_LIMIT,
  FAKTUROID_SOURCE,
  FakturoidClient,
  fakturoidOAuthConfig,
  FakturoidProvider,
} from "@bystro/integrations";

import type { InvoiceProviderResolver } from "./jobs/sync-invoices";

export interface FakturoidSettings {
  clientId: string;
  clientSecret: Secret;
  /** `Bystro (<contact e-mail>)`, required by Fakturoid on every request. */
  userAgent: string;
}

export interface ProviderSettings {
  /** `null` when Fakturoid is not configured in this environment. */
  fakturoid: FakturoidSettings | null;
}

/**
 * Chooses the adapter for a connection. A provider that is not configured here, or a
 * connection without the account it belongs to, gives `null`: the sync then fails with a
 * clear code instead of guessing.
 */
export function createInvoiceProviderResolver(settings: ProviderSettings): InvoiceProviderResolver {
  return (connection) => {
    if (connection.provider === FAKTUROID_SOURCE) {
      const { fakturoid } = settings;
      const slug = connection.externalAccountId;
      if (fakturoid === null || slug === null) {
        return null;
      }
      return {
        oauth: fakturoidOAuthConfig(fakturoid),
        // The limit belongs to the Fakturoid account, whoever in Bystro is connected to it.
        rateLimit: { key: rateLimitKey(FAKTUROID_SOURCE, slug), limit: FAKTUROID_RATE_LIMIT },
        create: (tokens) =>
          new FakturoidProvider(
            new FakturoidClient({
              accessToken: tokens.accessToken,
              userAgent: fakturoid.userAgent,
            }),
            slug,
          ),
      };
    }
    return null;
  };
}

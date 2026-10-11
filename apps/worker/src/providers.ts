import { rateLimitKey, type Secret } from "@bystro/core";
import {
  FAKTUROID_RATE_LIMIT,
  FAKTUROID_SOURCE,
  FakturoidClient,
  fakturoidOAuthConfig,
  FakturoidProvider,
  IDOKLAD_RATE_LIMIT,
  IDOKLAD_SOURCE,
  IdokladClient,
  IdokladLists,
  idokladOAuthConfig,
  IdokladProvider,
} from "@bystro/integrations";

import type { InvoiceProviderResolver } from "./jobs/sync-invoices";

export interface FakturoidSettings {
  clientId: string;
  clientSecret: Secret;
  /** `Bystro (<contact e-mail>)`, required by Fakturoid on every request. */
  userAgent: string;
}

export interface IdokladSettings {
  clientId: string;
  clientSecret: Secret;
}

export interface ProviderSettings {
  /** `null` when Fakturoid is not configured in this environment. */
  fakturoid: FakturoidSettings | null;
  /** `null` when iDoklad is not configured in this environment. */
  idoklad: IdokladSettings | null;
}

/**
 * Chooses the adapter for a connection. A provider that is not configured here, or a
 * connection without the account it belongs to, gives `null`: the sync then fails with a
 * clear code instead of guessing.
 */
export function createInvoiceProviderResolver(settings: ProviderSettings): InvoiceProviderResolver {
  // iDoklad's currency and country lists are the same for everyone: one copy per process.
  const idokladLists = new IdokladLists();
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
    if (connection.provider === IDOKLAD_SOURCE) {
      const { idoklad } = settings;
      const agendaId = connection.externalAccountId;
      if (idoklad === null || agendaId === null) {
        return null;
      }
      return {
        oauth: idokladOAuthConfig(idoklad),
        rateLimit: { key: rateLimitKey(IDOKLAD_SOURCE, agendaId), limit: IDOKLAD_RATE_LIMIT },
        create: (tokens) =>
          new IdokladProvider(new IdokladClient({ accessToken: tokens.accessToken }), idokladLists),
      };
    }
    return null;
  };
}

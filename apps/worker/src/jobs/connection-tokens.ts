import { ProviderError } from "@bystro/core";
import {
  updateConnectionTokens,
  type ConnectionTokens,
  type Db,
  type IntegrationConnection,
} from "@bystro/db";
import { refreshAccessToken, type OAuthProviderConfig } from "@bystro/integrations";

/** Refresh the access token when it expires within this time. */
const REFRESH_AHEAD_MS = 5 * 60 * 1000;

export interface TokenRefreshDeps {
  db: Db;
  encryptionKey: Buffer;
  now: () => Date;
  /** Injectable for tests; used for the token refresh request. */
  fetch?: typeof fetch;
}

/**
 * Returns tokens that are valid for at least a few more minutes: the stored ones, or new
 * ones from the provider, which are stored encrypted right away. Throws `reauth_required`
 * when the token cannot be refreshed; tokens are only ever held in memory.
 */
export async function freshConnectionTokens(
  deps: TokenRefreshDeps,
  connection: IntegrationConnection,
  oauth: OAuthProviderConfig | null,
  tokens: ConnectionTokens,
): Promise<ConnectionTokens> {
  const expiresSoon =
    tokens.expiresAt !== null &&
    tokens.expiresAt.getTime() - deps.now().getTime() < REFRESH_AHEAD_MS;
  if (!expiresSoon) {
    return tokens;
  }
  if (oauth === null || tokens.refreshToken === null) {
    throw new ProviderError("reauth_required");
  }
  const refreshed = await refreshAccessToken(
    oauth,
    { refreshToken: tokens.refreshToken },
    { now: deps.now(), ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }) },
  );
  const updated: ConnectionTokens = {
    accessToken: refreshed.accessToken,
    // Providers that do not rotate refresh tokens return none: keep the one we have.
    refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
    expiresAt: refreshed.expiresAt,
  };
  await updateConnectionTokens(
    deps.db,
    connection.organizationId,
    connection.id,
    updated,
    deps.encryptionKey,
  );
  return updated;
}

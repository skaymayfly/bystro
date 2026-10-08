import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { Secret } from "@bystro/core";
import { z } from "zod";

/**
 * Provider-independent OAuth 2.0 Authorization Code flow (RFC 6749) with PKCE (RFC 7636).
 * Nothing here knows a concrete provider: each adapter supplies an {@link OAuthProviderConfig}.
 * Tokens and secrets travel only as {@link Secret}, and errors never contain them.
 */

const REQUEST_TTL_MS = 10 * 60 * 1000;
const TOKEN_REQUEST_TIMEOUT_MS = 10_000;

export interface OAuthProviderConfig {
  /** Stable identifier of the provider, e.g. "fakturoid". */
  id: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret: Secret;
  scopes: readonly string[];
  /** "S256" wherever the provider supports PKCE; "none" only for providers that do not. */
  pkce: "S256" | "none";
  /** How the client authenticates at the token endpoint. */
  clientAuthentication: "basic" | "body";
  /** Extra query parameters some providers require on the authorization URL. */
  extraAuthorizationParams?: Readonly<Record<string, string>>;
  /** Extra headers some providers require on token requests (e.g. User-Agent). */
  tokenRequestHeaders?: Readonly<Record<string, string>>;
}

export type OAuthErrorCode =
  | "redirect_uri_not_allowed"
  | "invalid_state"
  | "request_expired"
  | "request_already_used"
  | "pkce_verifier_missing"
  | "provider_denied"
  | "missing_code"
  | "token_exchange_failed"
  | "invalid_token_response"
  | "reauthorization_required";

/** Thrown for every OAuth failure. Carries a machine-readable code and never any secret. */
export class OAuthError extends Error {
  override name = "OAuthError";

  constructor(
    readonly code: OAuthErrorCode,
    detail?: string,
  ) {
    super(detail === undefined ? `OAuth failed: ${code}` : `OAuth failed: ${code} (${detail})`);
  }
}

/** A started authorization, as it is kept on the server until the user comes back. */
export interface StoredOAuthRequest {
  provider: string;
  redirectUri: string;
  /** `null` when the provider does not support PKCE. */
  codeVerifier: Secret | null;
  expiresAt: Date;
  /** Set once the callback has been processed; a request can be used only once. */
  consumedAt: Date | null;
}

export interface AuthorizationRequest extends StoredOAuthRequest {
  /** Where to send the user's browser. Contains no secret. */
  url: string;
  /** SHA-256 of the `state` value: the lookup key to store. The raw state is not kept. */
  stateHash: string;
}

export interface OAuthTokens {
  accessToken: Secret;
  refreshToken: Secret | null;
  /** `null` when the provider does not say when the access token expires. */
  expiresAt: Date | null;
  /** Scopes the provider actually granted, when it reports them. */
  scopes: string[] | null;
}

const base64Url = (bytes: Buffer) => bytes.toString("base64url");

/** Hash under which an authorization request is stored and later found by its `state`. */
export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function assertRedirectAllowed(redirectUri: string, allowedRedirectUris: readonly string[]): void {
  // Exact string match on purpose: prefix or pattern matching is how open redirects happen.
  if (!allowedRedirectUris.includes(redirectUri)) {
    throw new OAuthError("redirect_uri_not_allowed");
  }
}

/**
 * Starts the flow: builds the provider URL and the record to store server-side.
 * The caller persists the result (minus `url`) and redirects the browser to `url`.
 */
export function createAuthorizationRequest(
  config: OAuthProviderConfig,
  options: { redirectUri: string; allowedRedirectUris: readonly string[]; now?: Date },
): AuthorizationRequest {
  assertRedirectAllowed(options.redirectUri, options.allowedRedirectUris);

  const state = base64Url(randomBytes(32));
  const verifier = config.pkce === "S256" ? base64Url(randomBytes(32)) : null;

  const url = new URL(config.authorizationEndpoint);
  for (const [key, value] of Object.entries(config.extraAuthorizationParams ?? {})) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("state", state);
  if (config.scopes.length > 0) {
    url.searchParams.set("scope", config.scopes.join(" "));
  }
  if (verifier !== null) {
    const challenge = base64Url(createHash("sha256").update(verifier).digest());
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
  }

  return {
    url: url.toString(),
    stateHash: hashOAuthState(state),
    provider: config.id,
    redirectUri: options.redirectUri,
    codeVerifier: verifier === null ? null : new Secret(verifier),
    expiresAt: new Date((options.now ?? new Date()).getTime() + REQUEST_TTL_MS),
    consumedAt: null,
  };
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Validates the provider's redirect back to us. `stored` is the request found by
 * `hashOAuthState(params.state)`, or `null` if there is none. Returns the authorization
 * code; the caller must then mark the request as consumed before exchanging the code.
 */
export function verifyCallback(
  config: OAuthProviderConfig,
  input: {
    params: { state?: string | null; code?: string | null; error?: string | null };
    stored: (StoredOAuthRequest & { stateHash: string }) | null;
    allowedRedirectUris: readonly string[];
    now?: Date;
  },
): { code: string } {
  const { params, stored } = input;
  const state = params.state ?? "";

  // The state is checked before anything else, including a provider error: an unsolicited
  // callback must not be able to trigger any behaviour.
  if (
    state === "" ||
    stored === null ||
    stored.provider !== config.id ||
    !sameHash(stored.stateHash, hashOAuthState(state))
  ) {
    throw new OAuthError("invalid_state");
  }
  if (stored.consumedAt !== null) {
    throw new OAuthError("request_already_used");
  }
  if (stored.expiresAt.getTime() <= (input.now ?? new Date()).getTime()) {
    throw new OAuthError("request_expired");
  }
  assertRedirectAllowed(stored.redirectUri, input.allowedRedirectUris);
  if (config.pkce === "S256" && stored.codeVerifier === null) {
    throw new OAuthError("pkce_verifier_missing");
  }
  if (typeof params.error === "string" && params.error !== "") {
    // The user declined, or the provider refused the request.
    throw new OAuthError("provider_denied");
  }
  const code = params.code ?? "";
  if (code === "") {
    throw new OAuthError("missing_code");
  }
  return { code };
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.coerce.number().positive().optional(),
  scope: z.string().optional(),
});

/** OAuth error codes from RFC 6749 that mean "the grant is no longer valid". */
const REAUTHORIZATION_ERRORS = new Set(["invalid_grant", "unauthorized_client", "access_denied"]);

async function requestTokens(
  config: OAuthProviderConfig,
  grant: Record<string, string>,
  options: { fetch?: typeof fetch; now?: Date },
  failure: "token_exchange_failed" | "reauthorization_required",
): Promise<OAuthTokens> {
  const body = new URLSearchParams(grant);
  const headers: Record<string, string> = {
    ...config.tokenRequestHeaders,
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (config.clientAuthentication === "basic") {
    const credentials = `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret.reveal())}`;
    headers.Authorization = `Basic ${Buffer.from(credentials).toString("base64")}`;
  } else {
    body.set("client_id", config.clientId);
    body.set("client_secret", config.clientSecret.reveal());
  }

  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(config.tokenEndpoint, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new OAuthError("token_exchange_failed", "network error or timeout");
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    // Only the standard `error` code is passed on; descriptions may echo request data.
    const providerError =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string" &&
      /^[a-z_]{1,40}$/.test(payload.error)
        ? payload.error
        : "unknown_error";
    const code =
      failure === "reauthorization_required" && !REAUTHORIZATION_ERRORS.has(providerError)
        ? "token_exchange_failed"
        : failure;
    throw new OAuthError(code, `${response.status} ${providerError}`);
  }

  const parsed = tokenResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new OAuthError("invalid_token_response");
  }
  const { access_token, refresh_token, expires_in, scope } = parsed.data;
  const now = options.now ?? new Date();
  return {
    accessToken: new Secret(access_token),
    refreshToken: refresh_token === undefined ? null : new Secret(refresh_token),
    expiresAt: expires_in === undefined ? null : new Date(now.getTime() + expires_in * 1000),
    scopes: scope === undefined ? null : scope.split(/\s+/).filter(Boolean),
  };
}

/**
 * Exchanges the authorization code for tokens. Server-side only: the client secret and the
 * PKCE verifier never reach the browser.
 */
export async function exchangeAuthorizationCode(
  config: OAuthProviderConfig,
  input: { code: string; stored: StoredOAuthRequest; allowedRedirectUris: readonly string[] },
  options: { fetch?: typeof fetch; now?: Date } = {},
): Promise<OAuthTokens> {
  assertRedirectAllowed(input.stored.redirectUri, input.allowedRedirectUris);
  if (config.pkce === "S256" && input.stored.codeVerifier === null) {
    throw new OAuthError("pkce_verifier_missing");
  }
  return requestTokens(
    config,
    {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.stored.redirectUri,
      ...(input.stored.codeVerifier === null
        ? {}
        : { code_verifier: input.stored.codeVerifier.reveal() }),
    },
    options,
    "token_exchange_failed",
  );
}

/**
 * Gets a new access token with the refresh token. Throws `reauthorization_required` when
 * the provider says the grant is gone (the connection must go to `reauth_required`), and
 * `token_exchange_failed` for temporary problems worth retrying.
 *
 * Providers that do not rotate refresh tokens return none; keep the old one in that case.
 */
export async function refreshAccessToken(
  config: OAuthProviderConfig,
  input: { refreshToken: Secret },
  options: { fetch?: typeof fetch; now?: Date } = {},
): Promise<OAuthTokens> {
  return requestTokens(
    config,
    { grant_type: "refresh_token", refresh_token: input.refreshToken.reveal() },
    options,
    "reauthorization_required",
  );
}

import { ProviderError, type Secret } from "@bystro/core";
import { z } from "zod";

import type { OAuthProviderConfig } from "../oauth/oauth";

/**
 * Gmail: the user's own mailbox. Documentation (read 2026-10-23):
 * - OAuth for web server apps: https://developers.google.com/identity/protocols/oauth2/web-server
 *   (endpoints and PKCE also from https://accounts.google.com/.well-known/openid-configuration)
 * - Scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
 * - users.getProfile: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile
 *
 * Tokens travel only as {@link Secret}; errors never contain them nor anything from a mailbox.
 */
export const GMAIL_SOURCE = "gmail";

/**
 * `gmail.modify`: read, label (archive) and send messages, no permanent deletion. A
 * restricted scope: public use needs Google's verification and a security assessment.
 */
export const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
export const GMAIL_SCOPES = [GMAIL_MODIFY_SCOPE] as const;

export const GOOGLE_ENDPOINTS = {
  authorization: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revocation: "https://oauth2.googleapis.com/revoke",
  gmailApi: "https://gmail.googleapis.com/gmail/v1",
} as const;
export type GoogleEndpoints = { [K in keyof typeof GOOGLE_ENDPOINTS]: string };

export interface GmailAppCredentials {
  /** OAuth client of the Google Cloud project (Credentials → OAuth client ID, web). */
  clientId: string;
  clientSecret: Secret;
  /** Only for tests against a local stand-in; defaults to Google. */
  endpoints?: GoogleEndpoints;
}

const endpointsOf = (credentials: GmailAppCredentials): GoogleEndpoints =>
  credentials.endpoints ?? GOOGLE_ENDPOINTS;

/**
 * Authorization Code flow with PKCE (S256, announced in Google's OpenID configuration).
 * `access_type=offline` is what makes Google return a refresh token, and `prompt=consent`
 * makes it return one again when the user connects a second time.
 */
export function gmailOAuthConfig(credentials: GmailAppCredentials): OAuthProviderConfig {
  const endpoints = endpointsOf(credentials);
  return {
    id: GMAIL_SOURCE,
    authorizationEndpoint: endpoints.authorization,
    tokenEndpoint: endpoints.token,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    scopes: GMAIL_SCOPES,
    pkce: "S256",
    clientAuthentication: "body",
    extraAuthorizationParams: { access_type: "offline", prompt: "consent" },
  };
}

/** Whether the user granted what Bystro needs; Google lets them untick scopes on consent. */
export function hasGmailScopes(granted: readonly string[] | null): boolean {
  // Google always reports the granted scopes; a missing list means we cannot tell.
  return granted !== null && GMAIL_SCOPES.every((scope) => granted.includes(scope));
}

/**
 * Revokes the grant at Google (POST /revoke with the token). Returns whether Google
 * confirmed it; a failure must not stop the user from disconnecting, so nothing is thrown.
 */
export async function revokeGoogleAccess(
  credentials: GmailAppCredentials,
  token: Secret,
  options: { fetch?: typeof fetch } = {},
): Promise<boolean> {
  try {
    const response = await (options.fetch ?? fetch)(endpointsOf(credentials).revocation, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: token.reveal() }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;

/**
 * Gmail limits each user to 6 000 quota units a minute (a message read costs 20–60, a
 * send 100). Counted in units, not requests.
 */
export const GMAIL_USER_QUOTA = { max: 6_000, windowMs: 60_000 } as const;

export interface GmailClientOptions {
  accessToken: Secret;
  /**
   * Called before every request with its cost in quota units, so that the caller can hold
   * back when the user's per-minute quota is used up.
   */
  onRequest?: (cost: number) => Promise<void>;
  /** Defaults to the real API. */
  apiBaseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/**
 * Reasons Google gives for a refusal, from `error.errors[].reason` and the newer
 * `error.details[].reason` (https://developers.google.com/workspace/gmail/api/guides/handle-errors).
 * Only these short codes are read; the messages are never kept or logged.
 */
function errorReasons(body: unknown): string[] {
  const error = (body as { error?: { errors?: unknown; details?: unknown } } | null)?.error;
  const reasons: string[] = [];
  for (const list of [error?.errors, error?.details]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const reason = (item as { reason?: unknown } | null)?.reason;
      if (typeof reason === "string") reasons.push(reason);
    }
  }
  return reasons;
}

const PER_MINUTE_LIMITS = ["rateLimitExceeded", "userRateLimitExceeded", "RATE_LIMIT_EXCEEDED"];
const DAILY_LIMITS = ["dailyLimitExceeded", "quotaExceeded"];
const API_DISABLED = ["accessNotConfigured", "SERVICE_DISABLED"];
const MISSING_SCOPE = ["insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"];
const DAILY_WAIT_MS = 60 * 60 * 1000;

function errorForStatus(status: number, headers: Headers, reasons: string[]): ProviderError {
  const has = (codes: string[]) => reasons.some((reason) => codes.includes(reason));
  if (status === 401) return new ProviderError("reauth_required");
  if (status === 429 || (status === 403 && has(PER_MINUTE_LIMITS))) {
    const retryAfter = Number(headers.get("retry-after"));
    return new ProviderError(
      "rate_limited",
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : DEFAULT_RATE_LIMIT_WAIT_MS,
    );
  }
  if (status === 403) {
    // Google answers 403 for very different things; only some of them are worth waiting out.
    if (has(DAILY_LIMITS)) return new ProviderError("rate_limited", DAILY_WAIT_MS);
    if (has(API_DISABLED)) return new ProviderError("api_disabled");
    if (has(["domainPolicy"])) return new ProviderError("account_blocked");
    if (has(MISSING_SCOPE)) return new ProviderError("reauth_required");
    return new ProviderError("forbidden");
  }
  if (status >= 500) return new ProviderError("provider_unavailable");
  return new ProviderError("invalid_response");
}

/** The resource does not exist (any more), or a history id is too old to continue from. */
export class GmailNotFoundError extends Error {
  override name = "GmailNotFoundError";
}

export class GmailClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: GmailClientOptions) {
    this.baseUrl = options.apiBaseUrl ?? GOOGLE_ENDPOINTS.gmailApi;
    this.fetchFn = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * GETs a resource of the signed-in user (`/users/me/…`). `cost` is the request's price in
   * quota units (see https://developers.google.com/workspace/gmail/api/reference/quota).
   * Repeated query parameters are given as arrays.
   */
  async getJson(
    path: string,
    query: Record<string, string | readonly string[]> = {},
    cost = 1,
  ): Promise<unknown> {
    const url = new URL(`${this.baseUrl}/users/me${path}`);
    for (const [name, value] of Object.entries(query)) {
      for (const item of typeof value === "string" ? [value] : value) {
        url.searchParams.append(name, item);
      }
    }
    return this.request(url, { method: "GET" }, cost);
  }

  /** POSTs a JSON body to a resource of the signed-in user (e.g. `threads/{id}/modify`). */
  async postJson(path: string, body: unknown, cost = 1): Promise<unknown> {
    return this.request(
      new URL(`${this.baseUrl}/users/me${path}`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      cost,
    );
  }

  private async request(url: URL, init: RequestInit, cost: number): Promise<unknown> {
    await this.options.onRequest?.(cost);
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          Authorization: `Bearer ${this.options.accessToken.reveal()}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ProviderError("provider_unavailable");
    }
    if (response.status === 404) {
      throw new GmailNotFoundError("Not found.");
    }
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      throw errorForStatus(response.status, response.headers, errorReasons(body));
    }
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new ProviderError("invalid_response");
    }
  }
}

const profileSchema = z.object({
  emailAddress: z.email(),
  historyId: z.string().regex(/^\d+$/),
});

export interface GmailProfile {
  /** The mailbox's address. Personal data: never logged. */
  emailAddress: string;
  /** Current point of the mailbox's change history; where syncing will start. */
  historyId: string;
}

/** The connected mailbox (GET /users/me/profile). */
export async function getGmailProfile(client: GmailClient): Promise<GmailProfile> {
  const body = await client.getJson("/profile");
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    throw new ProviderError("invalid_response");
  }
  return { emailAddress: parsed.data.emailAddress.toLowerCase(), historyId: parsed.data.historyId };
}

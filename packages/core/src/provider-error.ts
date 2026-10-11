/**
 * Failures of external systems, the same for every adapter. The code is what gets stored as
 * `last_error_code` of a connection and logged; messages never carry provider text, tokens
 * or data from the response.
 */

export const PROVIDER_ERROR_CODES = [
  /** The access was revoked or expired for good: the user has to connect again. */
  "reauth_required",
  /** The user's account at the provider may not do this. */
  "forbidden",
  /** The provider blocked the account (e.g. Fakturoid for an unpaid subscription). */
  "account_blocked",
  /** Too many requests; try again after `retryAfterMs`. */
  "rate_limited",
  /** Outage, maintenance, timeout or network error; worth trying again later. */
  "provider_unavailable",
  /** The response does not match the provider's documentation. */
  "invalid_response",
] as const;

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

const RETRYABLE: ReadonlySet<ProviderErrorCode> = new Set(["rate_limited", "provider_unavailable"]);

export class ProviderError extends Error {
  override name = "ProviderError";
  /** Whether repeating the same request later can succeed. */
  readonly retryable: boolean;

  constructor(
    readonly code: ProviderErrorCode,
    /** Only for `rate_limited`: how long to wait. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(`Provider error: ${code}`);
    this.retryable = RETRYABLE.has(code);
  }
}

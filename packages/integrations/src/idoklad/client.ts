import { ProviderError, type Secret } from "@bystro/core";
import { z } from "zod";

/**
 * HTTP access to iDoklad API v3. Documentation (read 2026-10-11):
 * https://api.idoklad.cz/Help/v3/cs/ — sections "Limity volání API", "Práce se seznamy",
 * "Filtrování", "HTTP kódy" and "Autorizace".
 *
 * Every request carries the bearer token, which is never logged nor put into an error.
 * Responses are wrapped: `{ Data, ErrorCode, IsSuccess, Message, StatusCode }`.
 */
export const IDOKLAD_API_BASE_URL = "https://api.idoklad.cz/v3";
/** The identity server issuing tokens (authorize, token and revocation endpoints). */
export const IDOKLAD_IDENTITY_BASE_URL = "https://identity.idoklad.cz/server";

/** Lists come in pages; the largest documented page size is 200 (the default is 20). */
export const IDOKLAD_PAGE_SIZE = 200;

/** Documented: 200 requests per minute, then 429 Too Many Requests. */
export const IDOKLAD_RATE_LIMIT = { max: 200, windowMs: 60_000 } as const;

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;

export interface IdokladClientOptions {
  accessToken: Secret;
  baseUrl?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

const envelopeSchema = z.object({
  Data: z.unknown(),
  IsSuccess: z.boolean().optional(),
});

function rateLimitWaitMs(headers: Headers): number {
  const retryAfter = Number(headers.get("retry-after"));
  return Number.isFinite(retryAfter) && retryAfter > 0
    ? retryAfter * 1000
    : DEFAULT_RATE_LIMIT_WAIT_MS;
}

/**
 * Turns a non-2xx status into the shared error codes, following the documented table of
 * HTTP codes. The response body is not used.
 */
function errorForStatus(status: number, headers: Headers): ProviderError {
  if (status === 401) return new ProviderError("reauth_required");
  // 402: expired or insufficient plan. 403: the subscription has to be downgraded by hand.
  // 600: insufficient iDoklad plan. All three are for the user to sort out at iDoklad.
  if (status === 402 || status === 403 || status === 600) {
    return new ProviderError("account_blocked");
  }
  if (status === 429) return new ProviderError("rate_limited", rateLimitWaitMs(headers));
  if (status >= 500) return new ProviderError("provider_unavailable");
  // 400, 404, 405…: our request does not match the API — an integration bug.
  return new ProviderError("invalid_response");
}

export class IdokladClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: IdokladClientOptions) {
    this.baseUrl = options.baseUrl ?? IDOKLAD_API_BASE_URL;
    this.fetchFn = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * GETs a resource and returns what is inside the `Data` wrapper. Returns `null` for 404
   * when `allowNotFound` is set (the object does not exist); every other failure is a
   * {@link ProviderError}.
   */
  async getData(
    path: string,
    query: Record<string, string> = {},
    { allowNotFound = false }: { allowNotFound?: boolean } = {},
  ): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [name, value] of Object.entries(query)) {
      url.searchParams.set(name, value);
    }
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        headers: {
          Authorization: `Bearer ${this.options.accessToken.reveal()}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ProviderError("provider_unavailable");
    }
    if (response.status === 404 && allowNotFound) {
      return null;
    }
    if (!response.ok) {
      throw errorForStatus(response.status, response.headers);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ProviderError("invalid_response");
    }
    const envelope = envelopeSchema.safeParse(body);
    if (!envelope.success || envelope.data.IsSuccess === false) {
      throw new ProviderError("invalid_response");
    }
    return envelope.data.Data;
  }
}

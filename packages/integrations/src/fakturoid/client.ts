import { ProviderError, type Secret } from "@bystro/core";

/**
 * HTTP access to Fakturoid API v3. Documentation (read 2026-10-11):
 * - General rules, headers, rate limits, errors: https://www.fakturoid.cz/api/v3
 * - OAuth 2: https://www.fakturoid.cz/api/v3/authorization
 *
 * Every request carries `User-Agent: <app> (<contact e-mail>)` (required; without it the API
 * answers 400) and the bearer token. The token is never logged nor put into an error.
 */
export const FAKTUROID_API_BASE_URL = "https://app.fakturoid.cz/api/v3";

/** Collections come in pages of 40 records (documented). */
export const FAKTUROID_PAGE_SIZE = 40;

/** Documented example policy `default;q=400;w=60`: 400 requests per 60 seconds. */
export const FAKTUROID_RATE_LIMIT = { max: 400, windowMs: 60_000 } as const;

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;
/** The PDF is generated asynchronously; the API answers 204 until it is ready. */
const PDF_ATTEMPTS = 5;
const PDF_RETRY_DELAY_MS = 1_500;

const EMAIL = /^[^\s@()<>]+@[^\s@()<>]+\.[^\s@()<>]+$/;

/** The documented `User-Agent` format: `YourAppName (administrative@contact.com)`. */
export function fakturoidUserAgent(contactEmail: string): string {
  const email = contactEmail.trim();
  if (!EMAIL.test(email)) {
    throw new RangeError("The Fakturoid contact must be an e-mail address.");
  }
  return `Bystro (${email})`;
}

export interface FakturoidClientOptions {
  accessToken: Secret;
  /** From {@link fakturoidUserAgent}. */
  userAgent: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Injectable for tests; waits between PDF attempts. */
  sleep?: (ms: number) => Promise<void>;
}

export interface FakturoidPdf {
  content: Uint8Array;
  contentType: string;
}

/**
 * Seconds until the limit resets, from `X-RateLimit: default;r=398;t=55` (an RFC draft the
 * documentation refers to), else from `Retry-After`.
 */
export function rateLimitWaitMs(headers: Headers): number {
  const match = /(?:^|;)\s*t=(\d+)/.exec(headers.get("x-ratelimit") ?? "");
  if (match?.[1] !== undefined) {
    return Math.max(1, Number(match[1])) * 1000;
  }
  const retryAfter = Number(headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return retryAfter * 1000;
  }
  return DEFAULT_RATE_LIMIT_WAIT_MS;
}

/** Turns a non-2xx status into the shared error codes. The response body is not used. */
function errorForStatus(status: number, headers: Headers): ProviderError {
  if (status === 401) return new ProviderError("reauth_required");
  if (status === 402) return new ProviderError("account_blocked");
  if (status === 403) return new ProviderError("forbidden");
  if (status === 429) return new ProviderError("rate_limited", rateLimitWaitMs(headers));
  if (status >= 500) return new ProviderError("provider_unavailable");
  // 400, 415, 422…: our request does not match the API — an integration bug.
  return new ProviderError("invalid_response");
}

export class FakturoidClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: FakturoidClientOptions) {
    this.baseUrl = options.baseUrl ?? FAKTUROID_API_BASE_URL;
    this.fetchFn = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private async request(path: string, query: Record<string, string>, accept: string) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [name, value] of Object.entries(query)) {
      url.searchParams.set(name, value);
    }
    try {
      return await this.fetchFn(url, {
        headers: {
          Authorization: `Bearer ${this.options.accessToken.reveal()}`,
          "User-Agent": this.options.userAgent,
          Accept: accept,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ProviderError("provider_unavailable");
    }
  }

  /**
   * GETs a JSON document. Returns `null` for 404 when `allowNotFound` is set (the object
   * does not exist); every other failure is a {@link ProviderError}.
   */
  async getJson(
    path: string,
    query: Record<string, string> = {},
    { allowNotFound = false }: { allowNotFound?: boolean } = {},
  ): Promise<unknown> {
    const response = await this.request(path, query, "application/json");
    if (response.status === 404 && allowNotFound) {
      return null;
    }
    if (!response.ok) {
      throw errorForStatus(response.status, response.headers);
    }
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new ProviderError("invalid_response");
    }
  }

  /**
   * Downloads a PDF. Fakturoid answers 204 while it is still being generated, so this tries
   * a few times with a short pause. `null` when the document does not exist.
   */
  async getPdf(path: string): Promise<FakturoidPdf | null> {
    for (let attempt = 1; attempt <= PDF_ATTEMPTS; attempt += 1) {
      const response = await this.request(path, {}, "application/pdf");
      if (response.status === 204) {
        if (attempt < PDF_ATTEMPTS) {
          await this.sleep(PDF_RETRY_DELAY_MS);
        }
        continue;
      }
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw errorForStatus(response.status, response.headers);
      }
      return {
        content: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") ?? "application/pdf",
      };
    }
    // Still being generated: worth asking again later.
    throw new ProviderError("provider_unavailable");
  }
}

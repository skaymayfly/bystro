/**
 * Where the browser goes after a connection attempt, and how the outcome is told to the
 * page. Only fixed pages are possible, so the flow can never be used as an open redirect.
 */

export const RETURN_TARGETS = ["settings", "onboarding", "mail"] as const;
export type ReturnTarget = (typeof RETURN_TARGETS)[number];

/** Outcome codes shown by the page; they are words, not messages, so nothing leaks. */
export const CONNECT_OUTCOMES = [
  "ok",
  "vybrat-ucet",
  "zamitnuto",
  "neplatne",
  "nedostupne",
  "bez-uctu",
  "tarif",
  "opravneni",
] as const;
export type ConnectOutcome = (typeof CONNECT_OUTCOMES)[number];

export const RETURN_COOKIE = "bystro_connect_return";
const RETURN_COOKIE_MAX_AGE_SECONDS = 15 * 60;

export function parseReturnTarget(value: unknown): ReturnTarget {
  return value === "onboarding" || value === "mail" ? value : "settings";
}

export function parseConnectOutcome(value: unknown): ConnectOutcome | null {
  return CONNECT_OUTCOMES.find((outcome) => outcome === value) ?? null;
}

/** Applications that can be connected through these routes. */
export const CONNECT_PROVIDERS = ["fakturoid", "idoklad", "gmail"] as const;
export type ConnectProvider = (typeof CONNECT_PROVIDERS)[number];

/**
 * Path of the page to return to, with the outcome and the application it is about in the
 * query (`propojeni`, `aplikace`).
 */
export function returnPath(
  target: ReturnTarget,
  outcome: ConnectOutcome,
  provider: ConnectProvider = "fakturoid",
): string {
  // Choosing an account happens in settings, wherever the user started.
  const page =
    target === "onboarding" && outcome !== "vybrat-ucet"
      ? "/onboarding?krok=2"
      : target === "mail"
        ? "/app/posta?zdroj=propojeni"
        : "/app/nastaveni?karta=propojeni";
  return `${page}&propojeni=${outcome}&aplikace=${provider}`;
}

/** `Set-Cookie` value remembering the return page while the user is at the provider. */
export function returnCookie(target: ReturnTarget, appBaseUrl: string): string {
  const secure = new URL(appBaseUrl).protocol === "https:" ? "; Secure" : "";
  // Lax: the cookie must come back on the top-level navigation from the provider.
  return `${RETURN_COOKIE}=${target}; Path=/api/integrations; Max-Age=${RETURN_COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}

/** Reads the return page from the request's cookies. */
export function readReturnTarget(cookieHeader: string | null): ReturnTarget {
  const match = new RegExp(`(?:^|;\\s*)${RETURN_COOKIE}=([a-z]+)`).exec(cookieHeader ?? "");
  return parseReturnTarget(match?.[1]);
}

/** 303 redirect to a path of this app. */
export function redirectWithin(appBaseUrl: string, path: string, headers: HeadersInit = {}) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL(path, appBaseUrl).toString(),
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

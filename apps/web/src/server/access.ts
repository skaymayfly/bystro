/** Where unauthenticated visitors are sent. */
export const SIGN_IN_PATH = "/prihlaseni";
/** Where signed-in users land. */
export const APP_HOME_PATH = "/app";
/** Where signed-in users without a company are sent. */
export const ONBOARDING_PATH = "/onboarding";

/** Pages that need a session. */
const PROTECTED_PAGE_PREFIXES = [APP_HOME_PATH, ONBOARDING_PATH];

/**
 * API routes reachable without a session. Everything else under /api is denied by default,
 * so a new route is private unless it is added here on purpose.
 */
const PUBLIC_API_PREFIXES = ["/api/auth"];

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export type AccessDecision =
  { type: "allow" } | { type: "redirect"; location: string } | { type: "unauthorized" };

/**
 * First, optimistic gate used by the proxy. It only looks at whether a session cookie
 * exists; the session itself is always validated on the server before any data is read.
 */
export function decideAccess(
  pathname: string,
  search: string,
  hasSessionCookie: boolean,
): AccessDecision {
  if (isUnder(pathname, "/api")) {
    const isPublic = PUBLIC_API_PREFIXES.some((prefix) => isUnder(pathname, prefix));
    return isPublic || hasSessionCookie ? { type: "allow" } : { type: "unauthorized" };
  }
  if (!hasSessionCookie && PROTECTED_PAGE_PREFIXES.some((prefix) => isUnder(pathname, prefix))) {
    const next = encodeURIComponent(`${pathname}${search}`);
    return { type: "redirect", location: `${SIGN_IN_PATH}?next=${next}` };
  }
  return { type: "allow" };
}

/**
 * Returns a safe in-app path to continue to after signing in.
 * Anything that is not a plain path under /app falls back to the app home (no open redirects).
 */
export function safeNextPath(next: string | null | undefined): string {
  if (typeof next !== "string" || !isUnder(next.split(/[?#]/)[0] ?? "", APP_HOME_PATH)) {
    return APP_HOME_PATH;
  }
  const hasControlCharacter = [...next].some((char) => char.charCodeAt(0) < 0x20);
  if (next.includes("\\") || next.includes("//") || hasControlCharacter) {
    return APP_HOME_PATH;
  }
  return next;
}

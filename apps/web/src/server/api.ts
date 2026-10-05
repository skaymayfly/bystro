import { getRequestContext, type RequestContext } from "./context";

/** JSON response that is never cached: API answers depend on who is signed in. */
export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * For route handlers: the validated request context, or a ready 401 response.
 * The proxy only checks that a session cookie exists, so every handler must call this.
 */
export async function requireApiContext(): Promise<RequestContext | Response> {
  const context = await getRequestContext();
  return context ?? json({ error: "unauthorized" }, 401);
}

/**
 * Basic CSRF defence for state-changing requests: the browser-set `Origin` header must
 * match the app's own origin. Requests without an `Origin` are rejected.
 */
export function isSameOrigin(request: Request, appBaseUrl: string): boolean {
  const origin = request.headers.get("origin");
  if (origin === null || !URL.canParse(origin)) {
    return false;
  }
  return new URL(origin).origin === new URL(appBaseUrl).origin;
}

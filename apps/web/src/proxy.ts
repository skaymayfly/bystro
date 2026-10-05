import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { decideAccess } from "./server/access";

/**
 * Optimistic gate in front of /app and /api. It checks only that a session cookie exists;
 * pages and route handlers validate the session itself (see `server/context.ts`).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const decision = decideAccess(pathname, search, getSessionCookie(request) !== null);

  switch (decision.type) {
    case "redirect":
      return NextResponse.redirect(new URL(decision.location, request.url));
    case "unauthorized":
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    case "allow":
      return NextResponse.next();
  }
}

export const config = {
  matcher: ["/app/:path*", "/onboarding/:path*", "/api/:path*"],
};

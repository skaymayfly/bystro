import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/server/auth";

// The auth instance is created per first request, not at import time (see `getAuth`).
export function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}

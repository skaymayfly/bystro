import * as Sentry from "@sentry/nextjs";

/** Runs once when the Next.js server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./server/sentry");
  }
}

/** Reports errors thrown while rendering or handling a request (no-op without a DSN). */
export const onRequestError = Sentry.captureRequestError;

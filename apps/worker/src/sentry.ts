import { scrubSentryEvent, SENTRY_BASE_OPTIONS } from "@bystro/observability";
import * as Sentry from "@sentry/node";

/**
 * Starts error reporting when SENTRY_DSN is set; without it nothing is sent anywhere.
 * Returns whether Sentry is active.
 */
export function initSentry(env: Record<string, string | undefined> = process.env): boolean {
  const dsn = env.SENTRY_DSN?.trim();
  if (dsn === undefined || dsn === "") {
    return false;
  }
  Sentry.init({
    dsn,
    ...SENTRY_BASE_OPTIONS,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV ?? "development",
    beforeSend: (event) => scrubSentryEvent(event),
  });
  return true;
}

/** Reports an error if Sentry is active; a no-op otherwise. */
export function captureError(error: unknown): void {
  Sentry.captureException(error);
}

/** Gives pending events a moment to be delivered before the process exits. */
export async function flushSentry(): Promise<void> {
  await Sentry.flush(2_000);
}

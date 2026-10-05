import { scrubSentryEvent, SENTRY_BASE_OPTIONS } from "@bystro/observability/sentry";
import * as Sentry from "@sentry/nextjs";

/**
 * Browser-side error reporting: errors only, no session replay, no tracing.
 * The DSN is public by design; without NEXT_PUBLIC_SENTRY_DSN nothing is sent anywhere.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

if (dsn !== undefined && dsn !== "") {
  Sentry.init({
    dsn,
    ...SENTRY_BASE_OPTIONS,
    environment: process.env.NODE_ENV,
    beforeSend: (event) => scrubSentryEvent(event),
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

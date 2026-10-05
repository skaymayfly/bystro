import { scrubSentryEvent, SENTRY_BASE_OPTIONS } from "@bystro/observability/sentry";
import * as Sentry from "@sentry/nextjs";

/**
 * Server-side error reporting. Loaded once from `instrumentation.ts`.
 * Without SENTRY_DSN nothing is initialised and nothing is sent anywhere.
 * Docs: https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
 */
const dsn = process.env.SENTRY_DSN?.trim();

if (dsn !== undefined && dsn !== "") {
  Sentry.init({
    dsn,
    ...SENTRY_BASE_OPTIONS,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    beforeSend: (event) => scrubSentryEvent(event),
  });
}

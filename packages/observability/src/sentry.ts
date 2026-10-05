import { AMOUNT_KEY, redactDeep, redactText, SENSITIVE_KEY, type JsonValue } from "@bystro/core";

const EVENT_REDACTION = { keys: [SENSITIVE_KEY, AMOUNT_KEY], scrubText: true } as const;

/**
 * The parts of a Sentry event that can carry sensitive data. Structural on purpose, so
 * this package does not depend on a Sentry SDK and works for both the web and the worker.
 */
export interface ScrubbableEvent {
  message?: string | undefined;
  user?: { id?: string | number | undefined; [key: string]: unknown } | undefined;
  request?: Record<string, unknown> | undefined;
  exception?:
    | {
        values?:
          | {
              value?: string | undefined;
              stacktrace?: { frames?: ScrubbableFrame[] | undefined } | undefined;
            }[]
          | undefined;
      }
    | undefined;
  breadcrumbs?:
    { message?: string | undefined; data?: Record<string, unknown> | undefined }[] | undefined;
  extra?: Record<string, unknown> | undefined;
  contexts?: Record<string, Record<string, unknown> | undefined> | undefined;
  tags?: Record<string, unknown> | undefined;
  server_name?: string | undefined;
}

/** A stack frame: Sentry attaches source lines around it and, if enabled, local variables. */
interface ScrubbableFrame {
  context_line?: string | undefined;
  pre_context?: string[] | undefined;
  post_context?: string[] | undefined;
  vars?: Record<string, unknown> | undefined;
}

const scrubRecord = <T extends Record<string, unknown>>(value: T): T =>
  redactDeep(value, EVENT_REDACTION) as { [key: string]: JsonValue } as T;

/**
 * Removes sensitive data from a Sentry event before it leaves the process. Use as
 * `beforeSend` (and for transactions/breadcrumbs if those get enabled).
 *
 * Kept: error types, stack traces, the request method and path, the user's ID.
 * Dropped: cookies, headers, query string, request body, the rest of the user object.
 * Scrubbed: messages, source lines and local variables of stack frames, breadcrumbs,
 * extra data, contexts and tags.
 */
export function scrubSentryEvent<T extends object>(sentryEvent: T): T {
  // SDK event types are stricter than the structural shape used here; the fields touched
  // below exist with these meanings in every Sentry JavaScript SDK.
  const event = sentryEvent as ScrubbableEvent;
  if (event.request !== undefined) {
    const { method, url } = event.request;
    event.request = {
      ...(typeof method === "string" ? { method } : {}),
      // Path only: query strings can carry tokens (e.g. password-reset links).
      ...(typeof url === "string" ? { url: redactText(url.split(/[?#]/)[0] ?? "") } : {}),
    };
  }
  if (event.user !== undefined) {
    event.user = event.user.id === undefined ? {} : { id: event.user.id };
  }
  if (event.message !== undefined) {
    event.message = redactText(event.message);
  }
  for (const exception of event.exception?.values ?? []) {
    if (exception.value !== undefined) {
      exception.value = redactText(exception.value);
    }
    for (const frame of exception.stacktrace?.frames ?? []) {
      // Source lines can hold literals (test data, fixtures); local variables hold live data.
      if (frame.context_line !== undefined) {
        frame.context_line = redactText(frame.context_line);
      }
      if (frame.pre_context !== undefined) {
        frame.pre_context = frame.pre_context.map(redactText);
      }
      if (frame.post_context !== undefined) {
        frame.post_context = frame.post_context.map(redactText);
      }
      if (frame.vars !== undefined) {
        frame.vars = scrubRecord(frame.vars);
      }
    }
  }
  for (const breadcrumb of event.breadcrumbs ?? []) {
    if (breadcrumb.message !== undefined) {
      breadcrumb.message = redactText(breadcrumb.message);
    }
    if (breadcrumb.data !== undefined) {
      breadcrumb.data = scrubRecord(breadcrumb.data);
    }
  }
  if (event.extra !== undefined) {
    event.extra = scrubRecord(event.extra);
  }
  if (event.tags !== undefined) {
    event.tags = scrubRecord(event.tags);
  }
  if (event.contexts !== undefined) {
    event.contexts = scrubRecord(event.contexts);
  }
  delete event.server_name;
  return sentryEvent;
}

/** Sentry options shared by the web and the worker: errors only, no default PII. */
export const SENTRY_BASE_OPTIONS = {
  sendDefaultPii: false,
  tracesSampleRate: 0,
} as const;

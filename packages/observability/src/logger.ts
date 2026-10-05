import { AMOUNT_KEY, redactDeep, redactText, SENSITIVE_KEY } from "@bystro/core";
import pino, { type DestinationStream, type Logger } from "pino";

/**
 * What must never reach the logs (CLAUDE.md): tokens, passwords, e-mail addresses, IBANs
 * and amounts. Fields are redacted by name at any depth, and every string is additionally
 * scrubbed for values that look sensitive.
 */
const LOG_REDACTION = { keys: [SENSITIVE_KEY, AMOUNT_KEY], scrubText: true } as const;

export interface LoggerOptions {
  /** Which app writes the log, e.g. "web" or "worker". */
  service: string;
  /** Defaults to the LOG_LEVEL environment variable, then "info". */
  level?: string;
  /** Where to write; defaults to stdout. Tests pass an in-memory stream. */
  destination?: DestinationStream;
}

const redactObject = (value: object) => redactDeep(value, LOG_REDACTION) as Record<string, unknown>;

/** Child bindings are written verbatim by pino, so they are redacted when the child is made. */
function withRedactedChildren(logger: Logger): Logger {
  const createChild = logger.child.bind(logger) as unknown as (
    bindings: object,
    options?: object,
  ) => Logger;
  // pino's generic `child` signature cannot be expressed for a wrapper, hence the loose cast.
  (logger as { child: unknown }).child = (bindings: object, options?: object) =>
    withRedactedChildren(createChild(redactObject(bindings), options));
  return logger;
}

/**
 * Creates a structured JSON logger whose output is redacted before it is written.
 * Usage: `logger.info({ invoiceId }, "Invoice synced")`.
 */
export function createLogger(options: LoggerOptions): Logger {
  const logger = pino(
    {
      // An empty LOG_LEVEL (as in .env.example) means "not set".
      level: options.level ?? (process.env.LOG_LEVEL?.trim() || "info"),
      base: { service: options.service },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
      },
      // Errors are already turned into scrubbed plain objects by the hook below.
      serializers: { err: (value: unknown) => value },
      hooks: {
        // Runs for every log call, before pino serializes anything.
        logMethod(args, method) {
          const redacted = args.map((arg: unknown) => {
            if (typeof arg === "string") {
              return redactText(arg);
            }
            if (arg instanceof Error) {
              return redactObject({ err: arg });
            }
            return typeof arg === "object" && arg !== null ? redactObject(arg) : arg;
          });
          method.apply(this, redacted as Parameters<typeof method>);
        },
      },
    },
    options.destination ?? pino.destination(1),
  );
  return withRedactedChildren(logger);
}

export type { Logger };

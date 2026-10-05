/** Replacement for anything that must not be stored or logged. */
export const REDACTED = "[redacted]";

/**
 * Field names whose values are sensitive wherever they appear: credentials, session data,
 * bank identifiers and e-mail addresses. Used for audit metadata and for logs.
 */
export const SENSITIVE_KEY =
  /token|secret|passw|authorization|cookie|credential|api[_-]?key|iban|e[_-]?mail|account[_-]?number/i;

/** Field names that carry money. Logs must not contain amounts; audit metadata may. */
export const AMOUNT_KEY = /amount|balance|price|total|castk|částk|zustat|zůstat/i;

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const MAX_DEPTH = 6;

const TEXT_PATTERNS: readonly RegExp[] = [
  // e-mail addresses
  /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu,
  // HTTP bearer credentials
  /Bearer\s+[A-Za-z0-9._~+/=-]+/g,
  // IBAN, with or without spaces
  /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g,
  // Czech account number: [prefix-]number/bank code
  /\b(?:\d{1,6}-)?\d{2,10}\/\d{4}\b/g,
  // amounts with a currency, e.g. "12 500 Kč", "1 234,50 CZK", "€ 99"
  /(?:[-−]\s?)?\d[\d\s\u00a0.,]*\s?(?:Kč|CZK|EUR|USD|€|\$)/gi,
  /(?:€|\$)\s?\d(?:[\d\s\u00a0.,]*\d)?/g,
];

/**
 * Replaces e-mail addresses, bearer credentials, IBANs, Czech account numbers and amounts
 * with a currency inside free text. A safety net, not a guarantee: unusual formats pass
 * through, so sensitive values should not be put into log messages in the first place.
 */
export function redactText(text: string): string {
  return TEXT_PATTERNS.reduce((result, pattern) => result.replace(pattern, REDACTED), text);
}

export interface RedactOptions {
  /** Values under keys matching any of these patterns are replaced, at any depth. */
  keys: readonly RegExp[];
  /** Also scrub sensitive-looking substrings inside every string value. */
  scrubText?: boolean;
}

function redactValue(value: unknown, depth: number, options: RedactOptions): JsonValue | undefined {
  if (typeof value === "string") {
    return options.scrubText === true ? redactText(value) : value;
  }
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== "object") {
    // undefined, functions, symbols: not representable in JSON
    return undefined;
  }
  if (depth >= MAX_DEPTH) {
    return REDACTED;
  }
  if (value instanceof Error) {
    // Errors have non-enumerable fields; keep what helps debugging, scrubbed.
    return redactValue(
      { type: value.name, message: value.message, stack: value.stack, cause: value.cause },
      depth,
      { ...options, scrubText: true },
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1, options) ?? null);
  }
  const result: { [key: string]: JsonValue } = {};
  for (const [key, nested] of Object.entries(value)) {
    if (options.keys.some((pattern) => pattern.test(key))) {
      result[key] = REDACTED;
      continue;
    }
    const redacted = redactValue(nested, depth + 1, options);
    if (redacted !== undefined) {
      result[key] = redacted;
    }
  }
  return result;
}

/**
 * Returns a plain-JSON copy of `value` with sensitive content removed.
 * Never mutates the input; cycles and very deep structures are cut off.
 */
export function redactDeep(value: unknown, options: RedactOptions): JsonValue {
  return redactValue(value, 0, options) ?? null;
}

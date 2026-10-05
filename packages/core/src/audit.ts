/** Who caused an audited change. */
export const AUDIT_ACTOR_TYPES = ["user", "system", "agent"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

/** Which part of Bystro performed the change. */
export const AUDIT_SOURCES = ["web", "worker", "ai"] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

export const AUDIT_RESULTS = ["success", "failure"] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

export const REDACTED = "[redacted]";

const SENSITIVE_KEY =
  /token|secret|passw|authorization|cookie|credential|api[_-]?key|iban|e[_-]?mail|account[_-]?number/i;

const MAX_DEPTH = 6;

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function sanitizeValue(value: unknown, depth: number): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
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
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1) ?? null);
  }
  const result: { [key: string]: JsonValue } = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      result[key] = REDACTED;
      continue;
    }
    const sanitized = sanitizeValue(nested, depth + 1);
    if (sanitized !== undefined) {
      result[key] = sanitized;
    }
  }
  return result;
}

/**
 * Makes audit metadata safe to store: values under sensitive keys (tokens, passwords,
 * IBANs, e-mail addresses, …) are replaced with `[redacted]` at any nesting level and the
 * result is plain JSON. Redaction is by key name, so callers must still avoid putting
 * sensitive values under neutral keys.
 */
export function sanitizeAuditMetadata(metadata: Record<string, unknown>): {
  [key: string]: JsonValue;
} {
  return sanitizeValue(metadata, 0) as { [key: string]: JsonValue };
}

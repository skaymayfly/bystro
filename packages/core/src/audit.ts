import { redactDeep, SENSITIVE_KEY, type JsonValue } from "./redaction";

/** Who caused an audited change. */
export const AUDIT_ACTOR_TYPES = ["user", "system", "agent"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

/** Which part of Bystro performed the change. */
export const AUDIT_SOURCES = ["web", "worker", "ai"] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

export const AUDIT_RESULTS = ["success", "failure"] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

/**
 * Makes audit metadata safe to store: values under sensitive keys (tokens, passwords,
 * IBANs, e-mail addresses, …) are replaced with `[redacted]` at any nesting level and the
 * result is plain JSON. Redaction is by key name, so callers must still avoid putting
 * sensitive values under neutral keys.
 */
export function sanitizeAuditMetadata(metadata: Record<string, unknown>): {
  [key: string]: JsonValue;
} {
  return redactDeep(metadata, { keys: [SENSITIVE_KEY] }) as { [key: string]: JsonValue };
}

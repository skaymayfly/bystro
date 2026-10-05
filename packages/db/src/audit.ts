import {
  sanitizeAuditMetadata,
  type AuditActorType,
  type AuditResult,
  type AuditSource,
} from "@bystro/core";

import type { DbExecutor } from "./client";
import { requireUuid } from "./ids";
import { auditLogs } from "./schema";

export type AuditActor =
  | { type: "user"; userId: string }
  /** `userId` = the user on whose behalf the system or agent acted, if any. */
  | { type: Exclude<AuditActorType, "user">; userId?: string };

export interface AuditEntry {
  actor: AuditActor;
  /** What happened, as `<object>.<verb>`, e.g. "organization.created". */
  action: string;
  target: { type: string; id?: string };
  source: AuditSource;
  /** Defaults to "success". */
  result?: AuditResult;
  /** Extra context. Sanitized before storing; never put tokens, amounts or e-mails here. */
  metadata?: Record<string, unknown>;
}

/**
 * Appends one record to the audit log of the given organization.
 * Pass a transaction as `executor` to make the record part of the audited change.
 */
export async function writeAudit(
  executor: DbExecutor,
  organizationId: string,
  entry: AuditEntry,
): Promise<void> {
  await executor.insert(auditLogs).values({
    organizationId: requireUuid(organizationId, "organizationId"),
    actorType: entry.actor.type,
    actorUserId:
      entry.actor.userId === undefined ? null : requireUuid(entry.actor.userId, "actor.userId"),
    action: entry.action,
    targetType: entry.target.type,
    targetId: entry.target.id ?? null,
    source: entry.source,
    result: entry.result ?? "success",
    metadata: sanitizeAuditMetadata(entry.metadata ?? {}),
  });
}

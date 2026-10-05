/** Domain logic without I/O: invoices, matching, cashflow, actions, priorities. */
export const PACKAGE_NAME = "@bystro/core";

export {
  AUDIT_ACTOR_TYPES,
  AUDIT_RESULTS,
  AUDIT_SOURCES,
  REDACTED,
  sanitizeAuditMetadata,
  type AuditActorType,
  type AuditResult,
  type AuditSource,
  type JsonValue,
} from "./audit";
export type { EmailMessage, EmailSender } from "./email";
export {
  formatCzk,
  formatDate,
  formatWeekday,
  toDateParts,
  type DateOnly,
  type DateParts,
  type DateStyle,
} from "./format";
export { isValidIco, normalizeIco } from "./ico";
export { organizationInputSchema, type OrganizationInput } from "./organization-input";
export { ROLES, type Role } from "./roles";

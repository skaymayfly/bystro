/** Domain logic without I/O: invoices, matching, cashflow, actions, priorities. */
export const PACKAGE_NAME = "@bystro/core";

export {
  AUDIT_ACTOR_TYPES,
  AUDIT_RESULTS,
  AUDIT_SOURCES,
  sanitizeAuditMetadata,
  type AuditActorType,
  type AuditResult,
  type AuditSource,
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
export {
  canStartSync,
  canTransitionIntegration,
  INTEGRATION_CATEGORIES,
  INTEGRATION_EVENTS,
  INTEGRATION_STATUSES,
  IntegrationTransitionError,
  transitionIntegration,
  type IntegrationCategory,
  type IntegrationEvent,
  type IntegrationStatus,
} from "./integration-status";
export { organizationInputSchema, type OrganizationInput } from "./organization-input";
export {
  AMOUNT_KEY,
  redactDeep,
  REDACTED,
  redactText,
  SENSITIVE_KEY,
  type JsonValue,
  type RedactOptions,
} from "./redaction";
export { ROLES, type Role } from "./roles";
export { Secret } from "./secret";

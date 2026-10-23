/**
 * Drizzle schema, migrations, tenant-scoped data access, encryption.
 *
 * Tenant tables are deliberately not exported: tenant data is reachable only through
 * functions that take an `organizationId` (see `forOrganization`).
 */
export { checkActionStillValid, type ActionCheck } from "./action-checks";
export {
  ActionExpiredError,
  ActionNotFoundError,
  applyActionEvent,
  ApprovalRequiredError,
  decideAction,
  getAction,
  getApproval,
  listActions,
  proposeAction,
  type ActionSourceRef,
  type ProposeActionInput,
  type ProposedAction,
  type StoredAction,
  type StoredApproval,
} from "./actions";
export { writeAudit, type AuditActor, type AuditEntry } from "./audit";
export { createDb, type Db, type DbConnection, type DbExecutor } from "./client";
export { decrypt, DecryptionError, encrypt, parseEncryptionKey } from "./crypto";
export { EnvError, readDatabaseUrl, readEncryptionKey } from "./env";
export { pingDatabase } from "./health";
export { InvalidIdError } from "./ids";
export {
  applyConnectionEvent,
  ConnectionNotFoundError,
  consumeOAuthRequest,
  createOAuthRequest,
  deleteExpiredOAuthRequests,
  disconnectConnection,
  findOAuthRequest,
  getConnection,
  getSyncCursor,
  listConnections,
  listSyncTargets,
  markWebhookEventProcessed,
  readConnectionTokens,
  recordWebhookEvent,
  saveConnection,
  setConnectionAccount,
  setSyncCursor,
  updateConnectionTokens,
  type ConnectionTokens,
  type IntegrationConnection,
  type NewOAuthRequest,
  type OAuthRequestRecord,
  type SaveConnectionInput,
  type SyncTarget,
} from "./integrations";
export {
  countInvoiceLines,
  findUnknownCompanyExternalIds,
  getInvoiceDetail,
  hideSyncedData,
  listActiveInvoiceExternalIds,
  listCompanies,
  listInvoiceOverview,
  listInvoicePayments,
  listInvoices,
  markInvoicesDeleted,
  upsertCompanies,
  upsertInvoices,
  type InvoiceDetail,
  type InvoiceUpsertResult,
  type StoredCompany,
  type StoredInvoice,
  type StoredInvoiceLine,
  type StoredInvoicePayment,
  type SyncScope,
  type UpsertCounts,
} from "./invoices";
export {
  deleteMailMessages,
  deleteMailReceivedBefore,
  listMailMessages,
  listMailThreads,
  listStoredMailLabels,
  refreshMailThreads,
  setMailLabels,
  upsertMailMessages,
  type StoredMailMessage,
  type StoredMailThread,
} from "./mail";
export {
  createFirstOrganization,
  createOrganization,
  listOrganizationsForUser,
  OrganizationAlreadyExistsError,
  type CreateOrganizationInput,
  type Membership,
  type NewOrganization,
  type Organization,
} from "./organizations";
/** Tables owned by Better Auth; exported only so the auth adapter can be configured. */
export * as authSchema from "./schema/auth";
export { forOrganization, type AuditLog, type OrganizationScope } from "./tenant";

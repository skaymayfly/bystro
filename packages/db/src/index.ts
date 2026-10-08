/**
 * Drizzle schema, migrations, tenant-scoped data access, encryption.
 *
 * Tenant tables are deliberately not exported: tenant data is reachable only through
 * functions that take an `organizationId` (see `forOrganization`).
 */
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
  disconnectConnection,
  findOAuthRequest,
  getConnection,
  getSyncCursor,
  listConnections,
  markWebhookEventProcessed,
  readConnectionTokens,
  recordWebhookEvent,
  saveConnection,
  setSyncCursor,
  updateConnectionTokens,
  type ConnectionTokens,
  type IntegrationConnection,
  type NewOAuthRequest,
  type OAuthRequestRecord,
  type SaveConnectionInput,
} from "./integrations";
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

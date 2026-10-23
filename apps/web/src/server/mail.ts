import { ProviderError } from "@bystro/core";
import {
  archiveMailThread,
  getMailThread,
  listConnections,
  readConnectionTokens,
  writeAudit,
  type Db,
  type IntegrationConnection,
} from "@bystro/db";
import {
  archiveGmailThread,
  freshConnectionTokens,
  GMAIL_SOURCE,
  GmailClient,
  gmailOAuthConfig,
  OAuthError,
  type GmailAppCredentials,
} from "@bystro/integrations";

/**
 * Mail actions the user takes on the Pošta screen. The user's click is the decision, so
 * these are carried out right away (not through the action engine); each is audited
 * without any content of the mail.
 */

export interface MailDeps {
  db: Db;
  encryptionKey: Buffer;
  /** `null` when Gmail is not configured in this environment. */
  gmail: GmailAppCredentials | null;
  now?: () => Date;
  fetch?: typeof fetch;
}

/** The organization's connected mailbox, or `null` (never connected, or disconnected). */
export async function findMailbox(
  db: Db,
  organizationId: string,
): Promise<IntegrationConnection | null> {
  const connections = await listConnections(db, organizationId);
  return (
    connections.find(
      (connection) =>
        connection.category === "email" &&
        connection.provider === GMAIL_SOURCE &&
        connection.status !== "revoked",
    ) ?? null
  );
}

export type ArchiveThreadResult =
  { ok: true } | { ok: false; error: "not_found" | "reauth_required" | "provider_unavailable" };

/**
 * Archives a thread: in Gmail first (all its messages leave Doručené), then in Bystro, then
 * an audit record. If Gmail refuses, nothing changes in Bystro. A thread that no longer
 * exists in Gmail is taken out of Doručené here too.
 */
export async function archiveThread(
  deps: MailDeps,
  who: { organizationId: string; userId: string },
  threadExternalId: string,
): Promise<ArchiveThreadResult> {
  const { db } = deps;
  const mailbox = await findMailbox(db, who.organizationId);
  if (mailbox === null) {
    return { ok: false, error: "not_found" };
  }
  const scope = { organizationId: who.organizationId, connectionId: mailbox.id };
  const thread = await getMailThread(db, scope, threadExternalId, deps.encryptionKey);
  if (thread === null) {
    return { ok: false, error: "not_found" };
  }
  if (deps.gmail === null) {
    return { ok: false, error: "provider_unavailable" };
  }
  if (mailbox.status === "reauth_required") {
    return { ok: false, error: "reauth_required" };
  }
  const tokens = await readConnectionTokens(db, who.organizationId, mailbox.id, deps.encryptionKey);
  if (tokens === null) {
    return { ok: false, error: "reauth_required" };
  }

  const fetchOption = deps.fetch === undefined ? {} : { fetch: deps.fetch };
  try {
    const current = await freshConnectionTokens(
      {
        db,
        encryptionKey: deps.encryptionKey,
        now: deps.now ?? (() => new Date()),
        ...fetchOption,
      },
      mailbox,
      gmailOAuthConfig(deps.gmail),
      tokens,
    );
    const client = new GmailClient({
      accessToken: current.accessToken,
      ...(deps.gmail.endpoints === undefined ? {} : { apiBaseUrl: deps.gmail.endpoints.gmailApi }),
      ...fetchOption,
    });
    await archiveGmailThread(client, threadExternalId);
  } catch (error) {
    if (
      (error instanceof ProviderError && error.code === "reauth_required") ||
      (error instanceof OAuthError && error.code === "reauthorization_required")
    ) {
      return { ok: false, error: "reauth_required" };
    }
    if (error instanceof ProviderError || error instanceof OAuthError) {
      return { ok: false, error: "provider_unavailable" };
    }
    throw error;
  }

  const messages = await archiveMailThread(db, scope, threadExternalId);
  await writeAudit(db, who.organizationId, {
    actor: { type: "user", userId: who.userId },
    action: "mail.thread_archived",
    target: { type: "mail_thread", id: threadExternalId },
    source: "web",
    metadata: { provider: mailbox.provider, messages },
  });
  return { ok: true };
}

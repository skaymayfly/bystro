import {
  buildJobId,
  ProviderError,
  syncInvoicesJob,
  type Secret,
  type SyncInvoicesPayload,
} from "@bystro/core";
import {
  ConnectionNotFoundError,
  consumeOAuthRequest,
  createOAuthRequest,
  disconnectConnection,
  findOAuthRequest,
  getConnection,
  hideSyncedData,
  readConnectionTokens,
  saveConnection,
  setConnectionAccount,
  type Db,
  type IntegrationConnection,
} from "@bystro/db";
import {
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  FAKTUROID_SOURCE,
  FakturoidClient,
  fakturoidOAuthConfig,
  getIdokladAgenda,
  hashOAuthState,
  IDOKLAD_SCOPES,
  IDOKLAD_SOURCE,
  IdokladClient,
  idokladOAuthConfig,
  listFakturoidAccounts,
  OAuthError,
  revokeFakturoidAccess,
  revokeIdokladAccess,
  verifyCallback,
  type FakturoidAccount,
  type FakturoidAppCredentials,
  type IdokladAgenda,
  type IdokladAppCredentials,
  type OAuthProviderConfig,
  type OAuthTokens,
} from "@bystro/integrations";

/**
 * Connecting, refreshing and disconnecting external systems on behalf of the signed-in
 * user. Route handlers stay thin and call these functions; every one of them works inside
 * the organization it is given. Tokens never leave the server.
 */

export const FAKTUROID_CALLBACK_PATH = "/api/integrations/fakturoid/callback";
export const IDOKLAD_CALLBACK_PATH = "/api/integrations/idoklad/callback";

/** How often a user may ask for a sync by hand; the provider's request allowance is small. */
export const MANUAL_SYNC_INTERVAL_MS = 5 * 60 * 1000;

export type ConnectionFlowErrorCode =
  /** The link is unknown, expired, already used or belongs to someone else. */
  | "invalid_state"
  /** The user said no at the provider. */
  | "denied"
  /** The provider did not give us tokens or did not answer. */
  | "provider_unavailable"
  /** The user has no account at the provider that may read invoices. */
  | "no_account"
  /** The provider refuses the API for this account (e.g. a plan without API access). */
  | "account_blocked";

/** A failed connection attempt. Carries a code for the UI and never any secret. */
export class ConnectionFlowError extends Error {
  override name = "ConnectionFlowError";

  constructor(
    readonly code: ConnectionFlowErrorCode,
    /**
     * Where and why it failed, for the log only: a step and a machine code such as
     * `token: 400 invalid_client` or `account: invalid_response`. Never provider text.
     */
    readonly detail: string | null = null,
  ) {
    super(`Connection failed: ${code}`);
  }
}

interface BaseFlowDeps {
  db: Db;
  encryptionKey: Buffer;
  /** Public URL of the web app; the callback address is derived from it. */
  appBaseUrl: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

export interface FlowDeps extends BaseFlowDeps {
  fakturoid: FakturoidAppCredentials;
}

export interface IdokladFlowDeps extends BaseFlowDeps {
  idoklad: IdokladAppCredentials;
}

const callbackUri = (deps: BaseFlowDeps, path: string) => new URL(path, deps.appBaseUrl).toString();
const fetchOption = (deps: { fetch?: typeof fetch }) =>
  deps.fetch === undefined ? {} : { fetch: deps.fetch };

function fakturoidClient(deps: FlowDeps, accessToken: Secret) {
  return new FakturoidClient({
    accessToken,
    userAgent: deps.fakturoid.userAgent,
    ...(deps.fakturoid.baseUrl === undefined ? {} : { baseUrl: deps.fakturoid.baseUrl }),
    ...fetchOption(deps),
  });
}

/** Accounts of the user that Bystro can read invoices from. */
async function invoicingAccounts(deps: FlowDeps, client: FakturoidClient) {
  try {
    const accounts = await listFakturoidAccounts(client);
    return accounts.filter((account) => account.allowedScope.includes("invoices"));
  } catch (error) {
    if (error instanceof ProviderError) {
      throw new ConnectionFlowError("provider_unavailable", `account: ${error.code}`);
    }
    throw error;
  }
}

/**
 * Starts connecting Fakturoid: remembers the request on the server (only a hash of the
 * `state`) and returns the address at Fakturoid to send the browser to.
 */
export async function startFakturoidConnection(
  deps: FlowDeps,
  who: { organizationId: string; userId: string },
): Promise<string> {
  return startAuthorization(
    deps,
    fakturoidOAuthConfig(deps.fakturoid),
    FAKTUROID_CALLBACK_PATH,
    who,
  );
}

/**
 * Remembers an authorization request (with its PKCE verifier, encrypted, for providers that
 * use PKCE) and returns its URL.
 */
async function startAuthorization(
  deps: BaseFlowDeps,
  config: OAuthProviderConfig,
  callbackPath: string,
  who: { organizationId: string; userId: string },
): Promise<string> {
  const redirectUri = callbackUri(deps, callbackPath);
  const request = createAuthorizationRequest(config, {
    redirectUri,
    allowedRedirectUris: [redirectUri],
  });
  await createOAuthRequest(
    deps.db,
    who.organizationId,
    {
      userId: who.userId,
      provider: request.provider,
      stateHash: request.stateHash,
      codeVerifier: request.codeVerifier,
      redirectUri: request.redirectUri,
      expiresAt: request.expiresAt,
    },
    deps.encryptionKey,
  );
  return request.url;
}

export interface CompletedConnection {
  connection: IntegrationConnection;
  /** The user has several accounts and none matched the company: they have to pick one. */
  needsAccountChoice: boolean;
}

/**
 * Finishes connecting after Fakturoid sent the user back. The `state` must belong to a
 * request this very user started in this very organization, not expired and not used yet;
 * only then is the code exchanged for tokens (server to server) and the connection saved.
 */
export async function completeFakturoidConnection(
  deps: FlowDeps,
  who: { organization: { id: string; ico: string }; userId: string },
  params: CallbackParams,
): Promise<CompletedConnection> {
  const tokens = await finishAuthorization(
    deps,
    fakturoidOAuthConfig(deps.fakturoid),
    FAKTUROID_CALLBACK_PATH,
    { organizationId: who.organization.id, userId: who.userId },
    params,
  );

  const accounts = await invoicingAccounts(deps, fakturoidClient(deps, tokens.accessToken));
  if (accounts.length === 0) {
    // Nothing to connect to: do not keep a grant we cannot use.
    if (tokens.refreshToken !== null) {
      await revokeFakturoidAccess(deps.fakturoid, tokens.refreshToken, fetchOption(deps));
    }
    throw new ConnectionFlowError("no_account");
  }
  const [only] = accounts;
  const chosen =
    accounts.length === 1
      ? only
      : accounts.find((account) => account.registrationNo === who.organization.ico);

  const connection = await saveConnection(
    deps.db,
    who.organization.id,
    {
      provider: FAKTUROID_SOURCE,
      category: "invoicing",
      externalAccountId: chosen?.slug ?? null,
      displayName: chosen?.name ?? null,
      scopes: [],
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      },
      userId: who.userId,
      source: "web",
    },
    deps.encryptionKey,
  );
  return { connection, needsAccountChoice: chosen === undefined };
}

export interface CallbackParams {
  state: string | null;
  code: string | null;
  error: string | null;
}

/**
 * The provider-independent part of coming back: checks the `state` against a request of
 * this user in this organization, uses the request up and exchanges the code for tokens.
 */
async function finishAuthorization(
  deps: BaseFlowDeps,
  config: OAuthProviderConfig,
  callbackPath: string,
  who: { organizationId: string; userId: string },
  params: CallbackParams,
): Promise<OAuthTokens> {
  const allowedRedirectUris = [callbackUri(deps, callbackPath)];
  const stored =
    params.state === null || params.state === ""
      ? null
      : await findOAuthRequest(
          deps.db,
          who.organizationId,
          { stateHash: hashOAuthState(params.state), userId: who.userId },
          deps.encryptionKey,
        );

  let code: string;
  try {
    ({ code } = verifyCallback(config, { params, stored, allowedRedirectUris }));
  } catch (error) {
    if (error instanceof OAuthError) {
      throw new ConnectionFlowError(error.code === "provider_denied" ? "denied" : "invalid_state");
    }
    throw error;
  }
  // Of two requests with the same state only one gets past this point.
  if (stored === null || !(await consumeOAuthRequest(deps.db, who.organizationId, stored.id))) {
    throw new ConnectionFlowError("invalid_state");
  }

  try {
    return await exchangeAuthorizationCode(
      config,
      { code, stored, allowedRedirectUris },
      fetchOption(deps),
    );
  } catch (error) {
    if (error instanceof OAuthError) {
      throw new ConnectionFlowError("provider_unavailable", `token: ${error.detail ?? error.code}`);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------------------
// iDoklad
// ---------------------------------------------------------------------------------------

/**
 * Starts connecting iDoklad: remembers the request on the server (a hash of the `state`
 * only) and returns the address at iDoklad's identity server.
 */
export async function startIdokladConnection(
  deps: IdokladFlowDeps,
  who: { organizationId: string; userId: string },
): Promise<string> {
  return startAuthorization(deps, idokladOAuthConfig(deps.idoklad), IDOKLAD_CALLBACK_PATH, who);
}

/**
 * Finishes connecting iDoklad. The token belongs to one agenda (the company the user chose
 * while signing in at iDoklad), so there is no account to pick: the agenda is read and
 * saved with the connection. When it cannot be read, the grant is given back.
 */
export async function completeIdokladConnection(
  deps: IdokladFlowDeps,
  who: { organization: { id: string }; userId: string },
  params: CallbackParams,
): Promise<CompletedConnection> {
  const tokens = await finishAuthorization(
    deps,
    idokladOAuthConfig(deps.idoklad),
    IDOKLAD_CALLBACK_PATH,
    { organizationId: who.organization.id, userId: who.userId },
    params,
  );

  let agenda: IdokladAgenda;
  try {
    agenda = await getIdokladAgenda(
      new IdokladClient({
        accessToken: tokens.accessToken,
        ...(deps.idoklad.baseUrl === undefined ? {} : { baseUrl: deps.idoklad.baseUrl }),
        ...fetchOption(deps),
      }),
    );
  } catch (error) {
    if (error instanceof ProviderError) {
      if (tokens.refreshToken !== null) {
        await revokeIdokladAccess(deps.idoklad, tokens.refreshToken, fetchOption(deps));
      }
      throw new ConnectionFlowError(
        error.code === "account_blocked" ? "account_blocked" : "provider_unavailable",
        `account: ${error.code}`,
      );
    }
    throw error;
  }

  const connection = await saveConnection(
    deps.db,
    who.organization.id,
    {
      provider: IDOKLAD_SOURCE,
      category: "invoicing",
      externalAccountId: agenda.id,
      displayName: agenda.name,
      scopes: tokens.scopes ?? [...IDOKLAD_SCOPES],
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      },
      userId: who.userId,
      source: "web",
    },
    deps.encryptionKey,
  );
  return { connection, needsAccountChoice: false };
}

/** Accounts to offer when the connection has none chosen yet. */
export async function listSelectableFakturoidAccounts(
  deps: FlowDeps,
  where: { organizationId: string; connectionId: string },
): Promise<FakturoidAccount[]> {
  const tokens = await readConnectionTokens(
    deps.db,
    where.organizationId,
    where.connectionId,
    deps.encryptionKey,
  );
  if (tokens === null) {
    return [];
  }
  return invoicingAccounts(deps, fakturoidClient(deps, tokens.accessToken));
}

/**
 * Sets the account the user picked. The choice is checked against what Fakturoid says the
 * user can access, so a made-up slug is refused.
 */
export async function chooseFakturoidAccount(
  deps: FlowDeps,
  who: { organizationId: string; connectionId: string; userId: string },
  slug: string,
): Promise<IntegrationConnection | null> {
  const connection = await getConnection(deps.db, who.organizationId, who.connectionId);
  if (connection === null || connection.provider !== FAKTUROID_SOURCE) {
    return null;
  }
  const accounts = await listSelectableFakturoidAccounts(deps, who);
  const account = accounts.find((candidate) => candidate.slug === slug);
  if (account === undefined) {
    return null;
  }
  return setConnectionAccount(
    deps.db,
    who.organizationId,
    who.connectionId,
    { externalAccountId: account.slug, displayName: account.name },
    { userId: who.userId, source: "web" },
  );
}

// ---------------------------------------------------------------------------------------
// Sync on request
// ---------------------------------------------------------------------------------------

export type EnqueueSync = (data: SyncInvoicesPayload, jobId: string) => Promise<boolean>;

const SYNCABLE: ReadonlySet<IntegrationConnection["status"]> = new Set([
  "connected",
  "degraded",
  "error",
]);

/** Enqueues the first sync right after connecting. A queue outage must not undo the connection. */
export async function enqueueInitialSync(
  enqueue: EnqueueSync,
  connection: IntegrationConnection,
): Promise<boolean> {
  if (connection.externalAccountId === null) {
    return false;
  }
  try {
    return await enqueue(
      {
        organizationId: connection.organizationId,
        connectionId: connection.id,
        mode: "incremental",
      },
      buildJobId(syncInvoicesJob.name, connection.id, "connected", String(Date.now())),
    );
  } catch {
    // The hourly schedule picks the connection up.
    return false;
  }
}

export type ManualSyncResult = "enqueued" | "too_soon" | "not_syncable" | "not_found";

/**
 * "Aktualizovat": asks for a sync now, at most once per {@link MANUAL_SYNC_INTERVAL_MS}.
 * The job id contains the time slot, so impatient clicking cannot add more than one.
 */
export async function requestManualSync(
  deps: { db: Db; enqueue: EnqueueSync; now?: Date },
  where: { organizationId: string; connectionId: string },
): Promise<ManualSyncResult> {
  const connection = await getConnection(deps.db, where.organizationId, where.connectionId);
  if (connection === null) {
    return "not_found";
  }
  if (!SYNCABLE.has(connection.status) || connection.externalAccountId === null) {
    return "not_syncable";
  }
  const now = (deps.now ?? new Date()).getTime();
  const lastStarted = connection.lastSyncStartedAt?.getTime() ?? 0;
  if (now - lastStarted < MANUAL_SYNC_INTERVAL_MS) {
    return "too_soon";
  }
  const slot = Math.floor(now / MANUAL_SYNC_INTERVAL_MS);
  const added = await deps.enqueue(
    { organizationId: connection.organizationId, connectionId: connection.id, mode: "incremental" },
    buildJobId(syncInvoicesJob.name, connection.id, "manual", String(slot)),
  );
  return added ? "enqueued" : "too_soon";
}

// ---------------------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------------------

/**
 * Disconnects: revokes the grant at the provider (best effort), deletes the tokens, marks
 * the connection revoked and hides the data synced through it. Returns `false` when the
 * organization has no such connection.
 */
export async function disconnect(
  deps: {
    db: Db;
    encryptionKey: Buffer;
    fakturoid: FakturoidAppCredentials | null;
    idoklad: IdokladAppCredentials | null;
    fetch?: typeof fetch;
  },
  who: { organizationId: string; connectionId: string; userId: string },
): Promise<boolean> {
  const connection = await getConnection(deps.db, who.organizationId, who.connectionId);
  if (connection === null) {
    return false;
  }
  if (connection.status !== "revoked") {
    const tokens = await readConnectionTokens(
      deps.db,
      who.organizationId,
      who.connectionId,
      deps.encryptionKey,
    );
    if (
      connection.provider === FAKTUROID_SOURCE &&
      deps.fakturoid !== null &&
      tokens !== null &&
      tokens.refreshToken !== null
    ) {
      await revokeFakturoidAccess(deps.fakturoid, tokens.refreshToken, fetchOption(deps));
    }
    if (
      connection.provider === IDOKLAD_SOURCE &&
      deps.idoklad !== null &&
      tokens !== null &&
      tokens.refreshToken !== null
    ) {
      await revokeIdokladAccess(deps.idoklad, tokens.refreshToken, fetchOption(deps));
    }
    try {
      await disconnectConnection(deps.db, who.organizationId, who.connectionId, {
        userId: who.userId,
        source: "web",
      });
    } catch (error) {
      if (error instanceof ConnectionNotFoundError) {
        return false;
      }
      throw error;
    }
  }
  await hideSyncedData(deps.db, {
    organizationId: who.organizationId,
    connectionId: who.connectionId,
  });
  return true;
}

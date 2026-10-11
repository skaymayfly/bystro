/** Adapters for external systems (Fakturoid, Fio, ARES, …) behind Provider interfaces. */
export {
  ARES_DEFAULT_BASE_URL,
  lookupCompanyInAres,
  type AresCompany,
  type AresLookupOptions,
  type AresLookupResult,
} from "./ares/ares";
export { EmailSendError, ResendEmailSender, type ResendEmailSenderOptions } from "./email/resend";
export {
  FAKTUROID_API_BASE_URL,
  FAKTUROID_PAGE_SIZE,
  FAKTUROID_RATE_LIMIT,
  FakturoidClient,
  fakturoidUserAgent,
  type FakturoidClientOptions,
} from "./fakturoid/client";
export {
  FAKTUROID_AUTHORIZATION_ENDPOINT,
  FAKTUROID_REVOKE_ENDPOINT,
  FAKTUROID_SOURCE,
  FAKTUROID_TOKEN_ENDPOINT,
  fakturoidOAuthConfig,
  FakturoidProvider,
  listFakturoidAccounts,
  revokeFakturoidAccess,
  mapFakturoidInvoice,
  mapFakturoidPayments,
  mapFakturoidSubject,
  type FakturoidAccount,
  type FakturoidAppCredentials,
} from "./fakturoid/fakturoid";
export {
  INVOICE_SYNC_LOOKBACK_MONTHS,
  INVOICE_SYNC_MODES,
  syncInvoices,
  withRequestHook,
  type InvoiceSyncInput,
  type InvoiceSyncMode,
  type InvoiceSyncResult,
} from "./sync/invoice-sync";
export {
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  hashOAuthState,
  OAuthError,
  refreshAccessToken,
  verifyCallback,
  type AuthorizationRequest,
  type OAuthErrorCode,
  type OAuthProviderConfig,
  type OAuthTokens,
  type StoredOAuthRequest,
} from "./oauth/oauth";

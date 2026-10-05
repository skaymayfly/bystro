/** Adapters for external systems (Fakturoid, Fio, ARES, …) behind Provider interfaces. */
export {
  ARES_DEFAULT_BASE_URL,
  lookupCompanyInAres,
  type AresCompany,
  type AresLookupOptions,
  type AresLookupResult,
} from "./ares/ares";
export { EmailSendError, ResendEmailSender, type ResendEmailSenderOptions } from "./email/resend";

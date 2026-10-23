/** Settings shared by playwright.config.ts and the E2E helpers. */
export const E2E_PORT = 3100;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;
export const ARES_STUB_PORT = 3101;
export const ARES_STUB_URL = `http://localhost:${ARES_STUB_PORT}`;
export const FAKTUROID_STUB_PORT = 3102;
export const FAKTUROID_STUB_URL = `http://localhost:${FAKTUROID_STUB_PORT}`;
export const IDOKLAD_STUB_PORT = 3103;
export const IDOKLAD_STUB_URL = `http://localhost:${IDOKLAD_STUB_PORT}`;
export const GOOGLE_STUB_PORT = 3104;
export const GOOGLE_STUB_URL = `http://localhost:${GOOGLE_STUB_PORT}`;
/** Throwaway key (32 zero bytes) for encrypting tokens in the E2E database. */
export const E2E_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
/** Throwaway secret for the E2E server only; the helpers need it to mint session cookies. */
export const E2E_AUTH_SECRET = "e2e-only-secret-e2e-only-secret-e2e-only";

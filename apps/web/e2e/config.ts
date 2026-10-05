/** Settings shared by playwright.config.ts and the E2E helpers. */
export const E2E_PORT = 3100;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;
export const ARES_STUB_PORT = 3101;
export const ARES_STUB_URL = `http://localhost:${ARES_STUB_PORT}`;
/** Throwaway secret for the E2E server only; the helpers need it to mint session cookies. */
export const E2E_AUTH_SECRET = "e2e-only-secret-e2e-only-secret-e2e-only";

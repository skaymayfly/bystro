import { loadRootEnv, readTestDatabase } from "@bystro/db/testing";
import { defineConfig, devices } from "@playwright/test";

import {
  ARES_STUB_PORT,
  ARES_STUB_URL,
  E2E_AUTH_SECRET,
  E2E_BASE_URL,
  E2E_PORT,
} from "./e2e/config";

loadRootEnv();

// E2E runs a production build on its own port against the test database,
// so it never touches development data and can run next to `pnpm dev`.
const PORT = E2E_PORT;
// Optional: use an installed browser ("chrome", "msedge") instead of Playwright's Chromium.
const channel = process.env.E2E_BROWSER_CHANNEL?.trim();
const baseURL = E2E_BASE_URL;
const aresStubUrl = ARES_STUB_URL;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], ...(channel ? { channel } : {}) },
    },
  ],
  webServer: [
    {
      // Replays recorded ARES responses; E2E never calls the real register.
      command: "node e2e/ares-stub.mjs",
      url: `${aresStubUrl}/health`,
      reuseExistingServer: false,
      env: { ARES_STUB_PORT: String(ARES_STUB_PORT) },
    },
    {
      command: `pnpm exec next build && pnpm exec next start --port ${PORT}`,
      url: baseURL,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        DATABASE_URL: readTestDatabase().url,
        BETTER_AUTH_URL: baseURL,
        BETTER_AUTH_SECRET: E2E_AUTH_SECRET,
        ARES_BASE_URL: aresStubUrl,
        // Keep third-party integrations off in E2E, whatever the developer has in .env.
        GOOGLE_CLIENT_ID: "",
        GOOGLE_CLIENT_SECRET: "",
        RESEND_API_KEY: "",
        EMAIL_FROM: "",
        SENTRY_DSN: "",
        NEXT_PUBLIC_SENTRY_DSN: "",
      },
    },
  ],
});

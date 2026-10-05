import type { EmailSender } from "@bystro/core";
import { ResendEmailSender } from "@bystro/integrations";

import { createAuth, type Auth } from "./auth-config";
import { getDb } from "./db";
import { logger } from "./logger";
import { readAuthEnv, readEmailEnv } from "./env";

/** Used until Resend is configured: sending fails loudly instead of pretending to work. */
const unconfiguredEmailSender: EmailSender = {
  async send() {
    throw new Error("System e-mails are not configured (RESEND_API_KEY, EMAIL_FROM).");
  },
};

function createEmailSender(): EmailSender {
  const emailEnv = readEmailEnv();
  return emailEnv === undefined ? unconfiguredEmailSender : new ResendEmailSender(emailEnv);
}

const globalForAuth = globalThis as typeof globalThis & { __bystroAuth?: Auth };

/**
 * The Better Auth instance, created on first use (not at import time, so that
 * `next build` does not need runtime secrets).
 */
export function getAuth(): Auth {
  globalForAuth.__bystroAuth ??= createAuth({
    db: getDb(),
    emailSender: createEmailSender(),
    env: readAuthEnv(),
    logger,
  });
  return globalForAuth.__bystroAuth;
}

/** Whether the "Pokračovat přes Google" button should be offered. */
export function isGoogleSignInEnabled(): boolean {
  return readAuthEnv().google !== undefined;
}

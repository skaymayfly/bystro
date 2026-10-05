import type { EmailSender } from "@bystro/core";
import { authSchema, type Db } from "@bystro/db";
import type { Logger } from "@bystro/observability";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { resetPasswordEmail } from "./emails/reset-password";
import type { AuthEnv } from "./env";

export const MIN_PASSWORD_LENGTH = 8;
const RESET_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * Google is used for identity only, so its tokens are never stored: these fields are
 * blanked on every account write. `encryptOAuthTokens` stays on as a second line of defence.
 */
const NO_OAUTH_TOKENS = {
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
} as const;

export interface AuthDependencies {
  db: Db;
  emailSender: EmailSender;
  env: AuthEnv;
  logger: Logger;
}

/**
 * Builds the Better Auth instance.
 * Docs: https://www.better-auth.com/docs/integrations/next
 *
 * Must stay in sync with `packages/db/src/schema/auth.ts`: plural table names and UUID ids.
 */
export function createAuth({ db, emailSender, env, logger }: AuthDependencies) {
  return betterAuth({
    appName: "Bystro",
    baseURL: env.baseUrl,
    secret: env.secret,
    database: drizzleAdapter(db, { provider: "pg", usePlural: true, schema: authSchema }),
    advanced: { database: { generateId: "uuid" } },

    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      autoSignIn: true,
      resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        // Not awaited on purpose (Better Auth docs): response time must not reveal whether
        // the address has an account. The link is a secret, so failures log no details.
        void emailSender.send(resetPasswordEmail({ to: user.email, url })).catch(() => {
          logger.error("Password reset e-mail could not be sent.");
        });
      },
    },

    // Default Google scopes in Better Auth are exactly `openid email profile`.
    ...(env.google === undefined
      ? {}
      : {
          socialProviders: {
            google: {
              clientId: env.google.clientId,
              clientSecret: env.google.clientSecret,
              includeGrantedScopes: false,
            },
          },
        }),

    // Better Auth writes its own diagnostics; route them through the redacting logger.
    logger: {
      log: (level, message, ...args) => {
        logger[level](
          args.length > 0 ? { source: "better-auth", args } : { source: "better-auth" },
          message,
        );
      },
    },

    account: { encryptOAuthTokens: true },
    databaseHooks: {
      account: {
        create: {
          before: async (account) => ({ data: { ...account, ...NO_OAUTH_TOKENS } }),
        },
        update: {
          before: async (account) => ({ data: { ...account, ...NO_OAUTH_TOKENS } }),
        },
      },
    },

    // Must be last: lets server actions set auth cookies.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

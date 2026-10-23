import { Secret } from "@bystro/core";
import {
  fakturoidUserAgent,
  type FakturoidAppCredentials,
  type GmailAppCredentials,
  type IdokladAppCredentials,
} from "@bystro/integrations";

/** Thrown for missing or invalid web configuration. The message never contains the value. */
export class WebEnvError extends Error {
  override name = "WebEnvError";
}

type Env = Record<string, string | undefined>;

const MIN_SECRET_LENGTH = 32;

function optional(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

export interface AuthEnv {
  secret: string;
  baseUrl: string;
  /** Present only when both Google variables are set. */
  google?: { clientId: string; clientSecret: string };
}

export function readAuthEnv(env: Env = process.env): AuthEnv {
  const secret = optional(env, "BETTER_AUTH_SECRET");
  if (secret === undefined) {
    throw new WebEnvError("BETTER_AUTH_SECRET is not set. See .env.example.");
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new WebEnvError(`BETTER_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`);
  }

  const baseUrl = optional(env, "BETTER_AUTH_URL");
  if (baseUrl === undefined || !URL.canParse(baseUrl)) {
    throw new WebEnvError("BETTER_AUTH_URL must be the public URL of the web app.");
  }

  const clientId = optional(env, "GOOGLE_CLIENT_ID");
  const clientSecret = optional(env, "GOOGLE_CLIENT_SECRET");
  if ((clientId === undefined) !== (clientSecret === undefined)) {
    throw new WebEnvError("Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither.");
  }

  return {
    secret,
    baseUrl,
    ...(clientId !== undefined && clientSecret !== undefined
      ? { google: { clientId, clientSecret } }
      : {}),
  };
}

/** Redis connection string (job queues from step 2.2, health check now). */
export function readRedisUrl(env: Env = process.env): string {
  const value = optional(env, "REDIS_URL");
  if (value === undefined || !(value.startsWith("redis://") || value.startsWith("rediss://"))) {
    throw new WebEnvError("REDIS_URL must be a redis:// or rediss:// connection string.");
  }
  return value;
}

const FAKTUROID_VARIABLES = [
  "FAKTUROID_CLIENT_ID",
  "FAKTUROID_CLIENT_SECRET",
  "INTEGRATIONS_CONTACT_EMAIL",
] as const;

/**
 * Fakturoid OAuth application, or `null` when it is not configured: the app then shows
 * Fakturoid as not available yet. Setting only some of the variables is an error.
 * FAKTUROID_BASE_URL exists for E2E tests only (a local stand-in for the API).
 */
export function readFakturoidEnv(env: Env = process.env): FakturoidAppCredentials | null {
  const values = FAKTUROID_VARIABLES.map((name) => optional(env, name));
  const [clientId, clientSecret, contactEmail] = values;
  if (clientId === undefined && clientSecret === undefined && contactEmail === undefined) {
    return null;
  }
  if (clientId === undefined || clientSecret === undefined || contactEmail === undefined) {
    throw new WebEnvError(`Set all of ${FAKTUROID_VARIABLES.join(", ")} or none of them.`);
  }
  let userAgent: string;
  try {
    userAgent = fakturoidUserAgent(contactEmail);
  } catch {
    throw new WebEnvError("INTEGRATIONS_CONTACT_EMAIL must be an e-mail address.");
  }
  const baseUrl = optional(env, "FAKTUROID_BASE_URL");
  if (baseUrl !== undefined && !URL.canParse(baseUrl)) {
    throw new WebEnvError("FAKTUROID_BASE_URL must be a URL.");
  }
  return {
    clientId,
    clientSecret: new Secret(clientSecret),
    userAgent,
    ...(baseUrl === undefined ? {} : { baseUrl }),
  };
}

/**
 * iDoklad OAuth application (registered at developer.idoklad.cz), or `null` when it is not
 * configured: the app then shows iDoklad as not available yet. Setting only one of the two
 * variables is an error. IDOKLAD_BASE_URL and IDOKLAD_IDENTITY_BASE_URL exist for E2E tests
 * only (a local stand-in for the API and the identity server).
 */
export function readIdokladEnv(env: Env = process.env): IdokladAppCredentials | null {
  const clientId = optional(env, "IDOKLAD_CLIENT_ID");
  const clientSecret = optional(env, "IDOKLAD_CLIENT_SECRET");
  if (clientId === undefined && clientSecret === undefined) {
    return null;
  }
  if (clientId === undefined || clientSecret === undefined) {
    throw new WebEnvError("Set both IDOKLAD_CLIENT_ID and IDOKLAD_CLIENT_SECRET, or neither.");
  }
  const baseUrl = optional(env, "IDOKLAD_BASE_URL");
  const identityBaseUrl = optional(env, "IDOKLAD_IDENTITY_BASE_URL");
  for (const [name, value] of [
    ["IDOKLAD_BASE_URL", baseUrl],
    ["IDOKLAD_IDENTITY_BASE_URL", identityBaseUrl],
  ] as const) {
    if (value !== undefined && !URL.canParse(value)) {
      throw new WebEnvError(`${name} must be a URL.`);
    }
  }
  return {
    clientId,
    clientSecret: new Secret(clientSecret),
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(identityBaseUrl === undefined ? {} : { identityBaseUrl }),
  };
}

/**
 * Google OAuth client for Gmail (reading and sending mail), or `null` when it is not
 * configured: the app then shows Gmail as not available yet. It may be the same client as
 * the Google sign-in; it is configured separately so that Gmail is switched on on purpose.
 * GMAIL_TEST_BASE_URL exists for E2E tests only (one local stand-in for Google).
 */
export function readGmailEnv(env: Env = process.env): GmailAppCredentials | null {
  const clientId = optional(env, "GMAIL_CLIENT_ID");
  const clientSecret = optional(env, "GMAIL_CLIENT_SECRET");
  if (clientId === undefined && clientSecret === undefined) {
    return null;
  }
  if (clientId === undefined || clientSecret === undefined) {
    throw new WebEnvError("Set both GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET, or neither.");
  }
  const testBase = optional(env, "GMAIL_TEST_BASE_URL");
  if (testBase !== undefined && !URL.canParse(testBase)) {
    throw new WebEnvError("GMAIL_TEST_BASE_URL must be a URL.");
  }
  return {
    clientId,
    clientSecret: new Secret(clientSecret),
    ...(testBase === undefined
      ? {}
      : {
          endpoints: {
            authorization: `${testBase}/o/oauth2/v2/auth`,
            token: `${testBase}/token`,
            revocation: `${testBase}/revoke`,
            gmailApi: `${testBase}/gmail/v1`,
          },
        }),
  };
}

/**
 * Namespace of the job queues in Redis. Must be the same as the worker's (the default);
 * only E2E tests set another one, to keep their jobs away from a running worker.
 */
export function readQueuePrefix(env: Env = process.env): string | undefined {
  const value = optional(env, "QUEUE_PREFIX");
  if (value !== undefined && !/^[a-z0-9-]+$/.test(value)) {
    throw new WebEnvError("QUEUE_PREFIX may contain only lower-case letters, digits and dashes.");
  }
  return value;
}

/** Base URL of the ARES API; `undefined` means the official public endpoint. */
export function readAresBaseUrl(env: Env = process.env): string | undefined {
  const value = optional(env, "ARES_BASE_URL");
  if (value !== undefined && !URL.canParse(value)) {
    throw new WebEnvError("ARES_BASE_URL must be a URL.");
  }
  return value;
}

/** Resend settings, or `undefined` when system e-mails are not configured yet. */
export function readEmailEnv(env: Env = process.env): { apiKey: string; from: string } | undefined {
  const apiKey = optional(env, "RESEND_API_KEY");
  const from = optional(env, "EMAIL_FROM");
  if (apiKey === undefined && from === undefined) {
    return undefined;
  }
  if (apiKey === undefined || from === undefined) {
    throw new WebEnvError("Set both RESEND_API_KEY and EMAIL_FROM, or neither.");
  }
  return { apiKey, from };
}

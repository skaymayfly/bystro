import { Secret } from "@bystro/core";
import { EnvError, readDatabaseUrl, readEncryptionKey } from "@bystro/db";
import { fakturoidUserAgent } from "@bystro/integrations";

import type { ProviderSettings } from "./providers";

type Env = Record<string, string | undefined>;

export interface WorkerEnv {
  redisUrl: string;
  databaseUrl: string;
  /** Decrypts the tokens of connections (AES-256-GCM); the same key as the web uses. */
  encryptionKey: Buffer;
  /** How many jobs of one queue run at the same time. */
  concurrency: number;
  providers: ProviderSettings;
}

const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY = 50;

/** Redis connection string for the job queues. The error never contains the value. */
export function readRedisUrl(env: Env = process.env): string {
  const value = env.REDIS_URL?.trim();
  if (value === undefined || !(value.startsWith("redis://") || value.startsWith("rediss://"))) {
    throw new EnvError("REDIS_URL must be a redis:// or rediss:// connection string.");
  }
  return value;
}

function readConcurrency(env: Env): number {
  const value = env.WORKER_CONCURRENCY?.trim();
  if (value === undefined || value === "") {
    return DEFAULT_CONCURRENCY;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_CONCURRENCY) {
    throw new EnvError(`WORKER_CONCURRENCY must be a whole number from 1 to ${MAX_CONCURRENCY}.`);
  }
  return parsed;
}

const FAKTUROID_VARIABLES = [
  "FAKTUROID_CLIENT_ID",
  "FAKTUROID_CLIENT_SECRET",
  "INTEGRATIONS_CONTACT_EMAIL",
] as const;

/**
 * Fakturoid is optional: without its three variables the worker runs and Fakturoid syncs
 * fail with "provider_not_configured". Setting only some of them is a mistake worth
 * stopping for.
 */
function readFakturoid(env: Env): ProviderSettings["fakturoid"] {
  const values = FAKTUROID_VARIABLES.map((name) => env[name]?.trim() ?? "");
  const [clientId = "", clientSecret = "", contactEmail = ""] = values;
  if (values.every((value) => value === "")) {
    return null;
  }
  if (values.some((value) => value === "")) {
    throw new EnvError(`Set all of ${FAKTUROID_VARIABLES.join(", ")} or none of them.`);
  }
  let userAgent: string;
  try {
    userAgent = fakturoidUserAgent(contactEmail);
  } catch {
    throw new EnvError("INTEGRATIONS_CONTACT_EMAIL must be an e-mail address.");
  }
  return { clientId, clientSecret: new Secret(clientSecret), userAgent };
}

/** iDoklad is optional in the same way: both variables or neither. */
function readIdoklad(env: Env): ProviderSettings["idoklad"] {
  const clientId = env.IDOKLAD_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.IDOKLAD_CLIENT_SECRET?.trim() ?? "";
  if (clientId === "" && clientSecret === "") {
    return null;
  }
  if (clientId === "" || clientSecret === "") {
    throw new EnvError("Set both IDOKLAD_CLIENT_ID and IDOKLAD_CLIENT_SECRET, or neither.");
  }
  return { clientId, clientSecret: new Secret(clientSecret) };
}

/**
 * Gmail is optional in the same way. The worker needs the OAuth client to refresh the
 * mailbox's access token; it is the same pair the web app uses.
 */
function readGmail(env: Env): ProviderSettings["gmail"] {
  const clientId = env.GMAIL_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GMAIL_CLIENT_SECRET?.trim() ?? "";
  if (clientId === "" && clientSecret === "") {
    return null;
  }
  if (clientId === "" || clientSecret === "") {
    throw new EnvError("Set both GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET, or neither.");
  }
  return { clientId, clientSecret: new Secret(clientSecret) };
}

/** Reads everything the worker needs to start; throws {@link EnvError} on the first problem. */
export function readWorkerEnv(env: Env = process.env): WorkerEnv {
  return {
    redisUrl: readRedisUrl(env),
    databaseUrl: readDatabaseUrl(env),
    encryptionKey: readEncryptionKey(env),
    concurrency: readConcurrency(env),
    providers: { fakturoid: readFakturoid(env), idoklad: readIdoklad(env), gmail: readGmail(env) },
  };
}

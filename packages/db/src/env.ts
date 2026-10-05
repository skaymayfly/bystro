import { z } from "zod";

import { parseEncryptionKey } from "./crypto";

/** Thrown for missing or invalid configuration. The message never contains the value itself. */
export class EnvError extends Error {
  override name = "EnvError";
}

type Env = Record<string, string | undefined>;

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

/** Reads a PostgreSQL connection string from the given environment variable. */
export function readDatabaseUrl(env: Env = process.env, name = "DATABASE_URL"): string {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new EnvError(`${name} is not set. Copy .env.example to .env and fill it in.`);
  }
  if (!postgresUrl.safeParse(value).success) {
    throw new EnvError(`${name} is not a valid postgresql:// connection string.`);
  }
  return value;
}

/** Reads and validates the AES-256-GCM key from ENCRYPTION_KEY. */
export function readEncryptionKey(env: Env = process.env): Buffer {
  const value = env.ENCRYPTION_KEY;
  if (value === undefined || value === "") {
    throw new EnvError("ENCRYPTION_KEY is not set. See .env.example for how to generate it.");
  }
  try {
    return parseEncryptionKey(value);
  } catch {
    throw new EnvError("ENCRYPTION_KEY must be 32 random bytes encoded as base64.");
  }
}

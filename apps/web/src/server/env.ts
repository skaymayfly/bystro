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

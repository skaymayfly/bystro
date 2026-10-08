import { EnvError, readDatabaseUrl } from "@bystro/db";

type Env = Record<string, string | undefined>;

export interface WorkerEnv {
  redisUrl: string;
  databaseUrl: string;
  /** How many jobs of one queue run at the same time. */
  concurrency: number;
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

/** Reads everything the worker needs to start; throws {@link EnvError} on the first problem. */
export function readWorkerEnv(env: Env = process.env): WorkerEnv {
  return {
    redisUrl: readRedisUrl(env),
    databaseUrl: readDatabaseUrl(env),
    concurrency: readConcurrency(env),
  };
}

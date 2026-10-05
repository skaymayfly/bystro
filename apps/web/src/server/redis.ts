import { Redis } from "ioredis";

import { readRedisUrl } from "./env";

const globalForRedis = globalThis as typeof globalThis & { __bystroRedis?: Redis };

/**
 * The web app's Redis connection, created on first use. Commands fail fast instead of
 * queueing while Redis is unreachable, so a health check gets a prompt answer.
 */
function getRedis(): Redis {
  globalForRedis.__bystroRedis ??= new Redis(readRedisUrl(), {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
    // Resolve both IPv4 and IPv6: private networks of hosting providers are often IPv6-only.
    family: 0,
  }).on("error", () => {
    // Connection errors surface through the commands; an unhandled event would crash the app.
  });
  return globalForRedis.__bystroRedis;
}

/** Resolves `true` when Redis answers PING, `false` otherwise. Never throws. */
export async function pingRedis(): Promise<boolean> {
  try {
    const redis = getRedis();
    if (redis.status === "wait" || redis.status === "end") {
      await redis.connect();
    }
    return (await redis.ping()) === "PONG";
  } catch {
    return false;
  }
}

import { randomUUID } from "node:crypto";

import { loadRootEnv } from "@bystro/db/testing";
import { createLogger } from "@bystro/observability";

import { readRedisUrl } from "../env";
import { createQueues, createRedisConnection, type Queues } from "../queues";

export const silentLogger = createLogger({ service: "worker-test", level: "silent" });

export interface TestQueues {
  queues: Queues;
  /** Removes every key of this test's namespace and closes the connection. */
  cleanup(): Promise<void>;
}

/**
 * Queues in a namespace of their own, so tests can run side by side (and next to a local
 * worker) on one Redis without seeing each other's jobs.
 */
export function createTestQueues(): TestQueues {
  loadRootEnv();
  let url: string;
  try {
    url = readRedisUrl();
  } catch {
    throw new Error("REDIS_URL is not set for tests. Copy .env.example to .env.");
  }
  const connection = createRedisConnection(url);
  const prefix = `bystro-test-${randomUUID()}`;
  const queues = createQueues(connection, prefix);

  return {
    queues,
    async cleanup() {
      await queues.close();
      const keys = await connection.keys(`${prefix}:*`);
      if (keys.length > 0) {
        await connection.del(...keys);
      }
      await connection.quit();
    },
  };
}

/** Polls until the check passes; fails with the last error after the timeout. */
export async function eventually(check: () => Promise<void> | void, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() > deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

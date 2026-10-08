import { cleanupOAuthRequestsJob } from "@bystro/core";
import { createDb, deleteExpiredOAuthRequests } from "@bystro/db";

import { readWorkerEnv } from "./env";
import { cleanupOAuthRequestsHandler } from "./jobs/cleanup-oauth-requests";
import { logger } from "./logger";
import { JobRegistry, startWorkers, type Workers } from "./processing";
import { createQueues, createRedisConnection, registerSchedules, type Queues } from "./queues";
import { captureError, flushSentry, initSentry } from "./sentry";

/** Message the deployment check looks for in the log. */
const READY_MESSAGE = "Bystro worker: ready";

interface Running {
  workers: Workers;
  queues: Queues;
  closeConnections: () => Promise<void>;
}

let running: Running | undefined;
let stopping = false;

async function start(): Promise<void> {
  const sentryEnabled = initSentry();
  const env = readWorkerEnv();

  const { db, close: closeDb } = createDb(env.databaseUrl);
  const connection = createRedisConnection(env.redisUrl);
  connection.on("error", () => {
    // Reconnecting is automatic; the workers report what they cannot do meanwhile.
  });
  const queues = createQueues(connection);

  const registry = new JobRegistry().register(
    cleanupOAuthRequestsJob,
    cleanupOAuthRequestsHandler({
      deleteExpiredBefore: (moment) => deleteExpiredOAuthRequests(db, moment),
    }),
  );

  await registerSchedules(queues);
  const workers = startWorkers({
    queues,
    registry,
    logger,
    concurrency: env.concurrency,
    reportError: captureError,
  });

  running = {
    workers,
    queues,
    async closeConnections() {
      await queues.close();
      await connection.quit();
      await closeDb();
    },
  };
  logger.info({ sentryEnabled, concurrency: env.concurrency }, READY_MESSAGE);
}

/**
 * Stops on request from the host (deploys, restarts): no new jobs are taken, running ones
 * get to finish, then connections close. Exits explicitly because libraries may hold the
 * event loop open; a worker that ignores SIGTERM gets killed mid-job after a grace period.
 */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  logger.info({ signal }, "Bystro worker: shutting down");
  try {
    await running?.workers.close();
    await running?.closeConnections();
  } catch (error) {
    captureError(error);
  }
  await flushSentry();
  process.exit(0);
}

/** A crash must be visible: log it, report it, then exit so the host restarts the worker. */
async function crash(error: unknown, origin: string): Promise<void> {
  logger.fatal({ err: error, origin }, "Bystro worker: fatal error");
  captureError(error);
  await flushSentry();
  process.exit(1);
}

process.on("SIGINT", (signal) => void shutdown(signal));
process.on("SIGTERM", (signal) => void shutdown(signal));
process.on("uncaughtException", (error) => void crash(error, "uncaughtException"));
process.on("unhandledRejection", (reason) => void crash(reason, "unhandledRejection"));

start().catch((error: unknown) => crash(error, "startup"));

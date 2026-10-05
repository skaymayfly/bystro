import { helloMessage } from "./hello";
import { logger } from "./logger";
import { captureError, flushSentry, initSentry } from "./sentry";

const sentryEnabled = initSentry();
logger.info({ sentryEnabled }, helloMessage());

// Placeholder until BullMQ arrives in step 2.2: keep the process alive like a real worker.
const keepAlive = setInterval(() => {}, 60_000);

let stopping = false;

/**
 * Stops on request from the host (deploys, restarts). Exits explicitly: libraries may hold
 * the event loop open, and a worker that ignores SIGTERM gets killed mid-job after a grace
 * period. Step 2.2 will wait for running jobs here before exiting.
 */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  logger.info({ signal }, "Bystro worker: shutting down");
  clearInterval(keepAlive);
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

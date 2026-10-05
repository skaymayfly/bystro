import { helloMessage } from "./hello";
import { logger } from "./logger";
import { captureError, flushSentry, initSentry } from "./sentry";

const sentryEnabled = initSentry();
logger.info({ sentryEnabled }, helloMessage());

// Placeholder until BullMQ arrives in step 2.2: keep the process alive like a real worker.
const keepAlive = setInterval(() => {}, 60_000);

function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, "Bystro worker: shutting down");
  clearInterval(keepAlive);
}

/** A crash must be visible: log it, report it, then exit so the host restarts the worker. */
async function crash(error: unknown, origin: string): Promise<void> {
  logger.fatal({ err: error, origin }, "Bystro worker: fatal error");
  captureError(error);
  await flushSentry();
  process.exit(1);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.on("uncaughtException", (error) => void crash(error, "uncaughtException"));
process.on("unhandledRejection", (reason) => void crash(reason, "unhandledRejection"));

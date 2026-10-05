import { helloMessage } from "./hello";

console.info(helloMessage());

// Placeholder until BullMQ arrives in step 2.2: keep the process alive like a real worker.
const keepAlive = setInterval(() => {}, 60_000);

function shutdown(signal: NodeJS.Signals): void {
  console.info(`Bystro worker: received ${signal}, shutting down`);
  clearInterval(keepAlive);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

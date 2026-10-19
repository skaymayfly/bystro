import { syncInvoicesJob } from "@bystro/core";
import { readEncryptionKey, type IntegrationConnection } from "@bystro/db";
import type { FakturoidAppCredentials, IdokladAppCredentials } from "@bystro/integrations";
import { createProducerConnection, createQueues, enqueue, type Queues } from "@bystro/queue";

import type { EnqueueSync, FlowDeps, IdokladFlowDeps } from "./connections";
import { getDb } from "./db";
import {
  readAuthEnv,
  readFakturoidEnv,
  readIdokladEnv,
  readQueuePrefix,
  readRedisUrl,
} from "./env";

/** Runtime wiring of the connection flows: configuration, database and job queue. */

const globalForQueues = globalThis as typeof globalThis & { __bystroQueues?: Queues };

export function getQueues(): Queues {
  globalForQueues.__bystroQueues ??= createQueues(
    createProducerConnection(readRedisUrl()),
    readQueuePrefix(),
  );
  return globalForQueues.__bystroQueues;
}

/** Adds an invoice sync to the worker's queue. */
export const enqueueInvoiceSync: EnqueueSync = (data, jobId) =>
  enqueue(getQueues(), syncInvoicesJob, data, { jobId });

/** The configured Fakturoid application, or `null` when this environment has none. */
export function getFakturoid(): FakturoidAppCredentials | null {
  return readFakturoidEnv();
}

/** Everything the Fakturoid connection flow needs, or `null` when Fakturoid is not configured. */
export function getFakturoidFlow(): FlowDeps | null {
  const fakturoid = getFakturoid();
  if (fakturoid === null) {
    return null;
  }
  return {
    db: getDb(),
    encryptionKey: readEncryptionKey(),
    fakturoid,
    appBaseUrl: readAuthEnv().baseUrl,
  };
}

/** The configured iDoklad application, or `null` when this environment has none. */
export function getIdoklad(): IdokladAppCredentials | null {
  return readIdokladEnv();
}

/** Everything the iDoklad connection flow needs, or `null` when iDoklad is not configured. */
export function getIdokladFlow(): IdokladFlowDeps | null {
  const idoklad = getIdoklad();
  if (idoklad === null) {
    return null;
  }
  return {
    db: getDb(),
    encryptionKey: readEncryptionKey(),
    idoklad,
    appBaseUrl: readAuthEnv().baseUrl,
  };
}

/** What the browser may know about a connection. Never tokens, never internal error text. */
export interface ConnectionView {
  id: string;
  provider: string;
  status: IntegrationConnection["status"];
  displayName: string | null;
  /** The user still has to pick which account at the provider to read. */
  needsAccount: boolean;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
  updatedAt: string | null;
}

export function toConnectionView(connection: IntegrationConnection): ConnectionView {
  return {
    id: connection.id,
    provider: connection.provider,
    status: connection.status,
    displayName: connection.displayName,
    needsAccount: connection.externalAccountId === null && connection.status !== "revoked",
    lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
    lastErrorCode: connection.lastErrorCode,
    updatedAt: connection.updatedAt.toISOString(),
  };
}

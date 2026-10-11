import {
  buildJobId,
  syncInvoicesJob,
  type DispatchInvoiceSyncPayload,
  type SyncInvoicesPayload,
} from "@bystro/core";
import type { SyncTarget } from "@bystro/db";

import type { JobHandler } from "../processing";

export interface DispatchInvoiceSyncDeps {
  /** Invoicing connections that can be synced, in every organization (identifiers only). */
  listTargets: () => Promise<SyncTarget[]>;
  /** Adds a sync job; `false` when a job with this id already exists. */
  enqueue: (data: SyncInvoicesPayload, jobId: string) => Promise<boolean>;
  now?: () => Date;
}

/**
 * Enqueues one sync per invoicing connection. The job id contains the connection, the mode
 * and the hour, so a repeated dispatch in the same hour adds nothing.
 */
export function dispatchInvoiceSyncHandler(
  deps: DispatchInvoiceSyncDeps,
): JobHandler<DispatchInvoiceSyncPayload> {
  const now = deps.now ?? (() => new Date());
  return async ({ data, logger }) => {
    const hour = now().toISOString().slice(0, 13);
    const targets = await deps.listTargets();
    let enqueued = 0;
    for (const target of targets) {
      const added = await deps.enqueue(
        {
          organizationId: target.organizationId,
          connectionId: target.connectionId,
          mode: data.mode,
        },
        buildJobId(syncInvoicesJob.name, target.connectionId, data.mode, hour),
      );
      if (added) enqueued += 1;
    }
    logger.info(
      { mode: data.mode, connections: targets.length, enqueued },
      "Invoice syncs dispatched",
    );
  };
}

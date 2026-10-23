import {
  buildJobId,
  syncMailJob,
  type DispatchMailSyncPayload,
  type SyncMailPayload,
} from "@bystro/core";
import type { SyncTarget } from "@bystro/db";

import type { JobHandler } from "../processing";

export interface DispatchMailSyncDeps {
  /** Mailbox connections that can be synced, in every organization (identifiers only). */
  listTargets: () => Promise<SyncTarget[]>;
  /** Adds a sync job; `false` when a job with this id already exists. */
  enqueue: (data: SyncMailPayload, jobId: string) => Promise<boolean>;
  now?: () => Date;
}

/** Mail is dispatched every few minutes; a job id is unique within one such slot. */
const SLOT_MS = 5 * 60 * 1000;

/**
 * Enqueues one mail sync per mailbox connection. The job id contains the connection, the
 * mode and the five-minute slot, so a repeated dispatch in the same slot adds nothing.
 */
export function dispatchMailSyncHandler(
  deps: DispatchMailSyncDeps,
): JobHandler<DispatchMailSyncPayload> {
  const now = deps.now ?? (() => new Date());
  return async ({ data, logger }) => {
    const slotStart = new Date(Math.floor(now().getTime() / SLOT_MS) * SLOT_MS);
    const slot = slotStart.toISOString().slice(0, 16).replace(":", "-");
    const targets = await deps.listTargets();
    let enqueued = 0;
    for (const target of targets) {
      const added = await deps.enqueue(
        {
          organizationId: target.organizationId,
          connectionId: target.connectionId,
          mode: data.mode,
        },
        buildJobId(syncMailJob.name, target.connectionId, data.mode, slot),
      );
      if (added) enqueued += 1;
    }
    logger.info(
      { mode: data.mode, connections: targets.length, enqueued },
      "Mail syncs dispatched",
    );
  };
}

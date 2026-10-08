import {
  JOB_SCHEDULES,
  QUEUE_NAMES,
  SCHEDULE_TIME_ZONE,
  type DeadLetter,
  type JobDefinition,
  type JobSchedule,
  type ProcessedQueueName,
} from "@bystro/core";
import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";

/** Namespace of all queue keys in Redis; tests use their own. */
export const DEFAULT_QUEUE_PREFIX = "bystro";

const DAY_SECONDS = 24 * 60 * 60;

/**
 * Connection for queues and workers. The queue library requires unlimited command retries;
 * `family: 0` resolves IPv4 and IPv6 because private hosting networks are often IPv6-only.
 */
export function createRedisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, family: 0 });
}

export interface Queues {
  connection: Redis;
  prefix: string;
  processed: Record<ProcessedQueueName, Queue>;
  deadLetter: Queue<DeadLetter>;
  close(): Promise<void>;
}

export function createQueues(connection: Redis, prefix = DEFAULT_QUEUE_PREFIX): Queues {
  const options = { connection, prefix };
  const processed = {
    sync: new Queue(QUEUE_NAMES.sync, options),
    actions: new Queue(QUEUE_NAMES.actions, options),
    scheduled: new Queue(QUEUE_NAMES.scheduled, options),
  };
  const deadLetter = new Queue<DeadLetter>(QUEUE_NAMES.deadLetter, options);

  return {
    connection,
    prefix,
    processed,
    deadLetter,
    async close() {
      await Promise.all([...Object.values(processed), deadLetter].map((queue) => queue.close()));
    },
  };
}

/**
 * Options every job of a definition gets. Retries use the worker's backoff strategy (the
 * rule lives in `@bystro/core`). Finished jobs stay for a while: as long as a job is kept,
 * adding another one with the same id is ignored.
 */
export function jobOptions(definition: JobDefinition<unknown>): JobsOptions {
  return {
    attempts: definition.retry.attempts,
    backoff: { type: "custom" },
    removeOnComplete: { age: DAY_SECONDS, count: 1_000 },
    removeOnFail: { age: 7 * DAY_SECONDS },
  };
}

export interface EnqueueOptions {
  /** Deterministic id from `buildJobId`; a job with the same id is not added twice. */
  jobId: string;
  delayMs?: number;
}

/**
 * Adds a job after validating its payload. Returns `false` when a job with this id is
 * already known to the queue, i.e. nothing was added.
 */
export async function enqueue<TData>(
  queues: Queues,
  definition: JobDefinition<TData>,
  data: TData,
  options: EnqueueOptions,
): Promise<boolean> {
  const payload = definition.schema.parse(data);
  const queue = queues.processed[definition.queue];
  if ((await queue.getJob(options.jobId)) !== undefined) {
    return false;
  }
  await queue.add(definition.name, payload, {
    ...jobOptions(definition as JobDefinition<unknown>),
    jobId: options.jobId,
    ...(options.delayMs === undefined ? {} : { delay: options.delayMs }),
  });
  return true;
}

/**
 * Makes the repeating jobs in Redis match the given list: creates or updates each schedule
 * and removes those that are no longer listed. Safe to run on every start and from several
 * worker instances.
 */
export async function registerSchedules(
  queues: Queues,
  schedules: readonly JobSchedule[] = JOB_SCHEDULES,
): Promise<void> {
  const queue = queues.processed.scheduled;
  for (const schedule of schedules) {
    await queue.upsertJobScheduler(
      schedule.id,
      { pattern: schedule.pattern, tz: SCHEDULE_TIME_ZONE },
      {
        name: schedule.job.name,
        data: {},
        opts: jobOptions(schedule.job as JobDefinition<unknown>),
      },
    );
  }

  const wanted = new Set(schedules.map((schedule) => schedule.id));
  for (const existing of await queue.getJobSchedulers()) {
    if (!wanted.has(existing.key)) {
      await queue.removeJobScheduler(existing.key);
    }
  }
}

import {
  buildJobId,
  DEFAULT_RETRY_POLICY,
  jobErrorCode,
  PROCESSED_QUEUES,
  retryDelayMs,
  sanitizeJobIdPart,
  type DeadLetter,
  type JobDefinition,
} from "@bystro/core";
import type { Logger } from "@bystro/observability";
import { DelayedError, UnrecoverableError, Worker, type Job } from "bullmq";

import type { Queues } from "./queues";
import { RateLimitedError } from "./rate-limiter";

export interface JobContext<TData> {
  /** Payload, already validated against the job's schema. */
  data: TData;
  jobId: string;
  /** 1 for the first try. */
  attempt: number;
  /** Logger bound to this job. Never log the payload or text from external systems. */
  logger: Logger;
}

/**
 * Does the work of one job. Must be idempotent: a job can run again after a crash or a
 * retry, and running it twice must not duplicate anything.
 */
export type JobHandler<TData> = (context: JobContext<TData>) => Promise<void>;

interface RegisteredJob {
  definition: JobDefinition<unknown>;
  handler: JobHandler<unknown>;
}

/** Which handler runs which job. Job names are unique across queues. */
export class JobRegistry {
  private readonly jobs = new Map<string, RegisteredJob>();

  register<TData>(definition: JobDefinition<TData>, handler: JobHandler<TData>): this {
    if (this.jobs.has(definition.name)) {
      throw new Error(`Job "${definition.name}" is already registered.`);
    }
    this.jobs.set(definition.name, {
      definition: definition as JobDefinition<unknown>,
      handler: handler as JobHandler<unknown>,
    });
    return this;
  }

  get(name: string): RegisteredJob | undefined {
    return this.jobs.get(name);
  }
}

/**
 * A failure that retrying cannot fix (unknown job, malformed payload, revoked access…).
 * The job goes straight to the dead-letter queue. `code` is a short machine code; the
 * message repeats it and nothing else.
 */
export class PermanentJobError extends UnrecoverableError {
  constructor(readonly code: string) {
    super(code);
  }
}

type Processor = (job: Job, token?: string) => Promise<void>;

/** Turns a registry into the function the queue library calls for every job. */
export function createProcessor(registry: JobRegistry, logger: Logger): Processor {
  return async (job, token) => {
    const registered = registry.get(job.name);
    if (registered === undefined) {
      throw new PermanentJobError("unknown_job");
    }
    // Whatever sits in Redis is input like any other: validate before use.
    const payload = registered.definition.schema.safeParse(job.data);
    if (!payload.success) {
      throw new PermanentJobError("invalid_payload");
    }

    const jobId = job.id ?? "";
    const attempt = job.attemptsMade + 1;
    const log = logger.child({ queue: job.queueName, job: job.name, jobId, attempt });
    const startedAt = Date.now();
    try {
      await registered.handler({ data: payload.data, jobId, attempt, logger: log });
      log.info({ durationMs: Date.now() - startedAt }, "Job completed");
    } catch (error) {
      if (error instanceof RateLimitedError) {
        // Not a failure: park the job until the limit frees up. No attempt is spent.
        await job.moveToDelayed(Date.now() + error.retryAfterMs, token);
        log.info({ retryAfterMs: error.retryAfterMs }, "Job postponed by a rate limit");
        throw new DelayedError();
      }
      throw error;
    }
  };
}

/** Whether a failed job will not be tried again. */
export function isFinalFailure(job: Job, error: Error): boolean {
  return error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
}

/**
 * Records a job that failed for good in the dead-letter queue. The id is derived from the
 * failed job, so recording the same failure twice keeps one entry.
 */
export async function recordDeadLetter(queues: Queues, job: Job, error: Error): Promise<void> {
  const entry: DeadLetter = {
    queue: job.queueName,
    name: job.name,
    jobId: job.id ?? "",
    data: job.data as unknown,
    attemptsMade: job.attemptsMade,
    errorCode: jobErrorCode(error),
    failedAt: new Date().toISOString(),
  };
  await queues.deadLetter.add(job.name, entry, {
    jobId: buildJobId("dead", sanitizeJobIdPart(job.queueName), sanitizeJobIdPart(entry.jobId)),
  });
}

export interface WorkersOptions {
  queues: Queues;
  registry: JobRegistry;
  logger: Logger;
  concurrency: number;
  /** Called for failures that need a human: dead letters and errors of the workers themselves. */
  reportError: (error: unknown) => void;
}

export interface Workers {
  /** Stops taking new jobs and waits for the running ones to finish. */
  close(): Promise<void>;
}

/** Starts one worker per processed queue. */
export function startWorkers(options: WorkersOptions): Workers {
  const { queues, registry, logger, concurrency, reportError } = options;
  const processor = createProcessor(registry, logger);

  const workers = PROCESSED_QUEUES.map((queueName) => {
    const worker = new Worker(queueName, processor, {
      connection: queues.connection,
      prefix: queues.prefix,
      concurrency,
      settings: {
        backoffStrategy: (attemptsMade, _type, _error, job) =>
          retryDelayMs(
            (job === undefined ? undefined : registry.get(job.name))?.definition.retry ??
              DEFAULT_RETRY_POLICY,
            attemptsMade,
          ),
      },
    });

    worker.on("failed", (job, error) => {
      if (job === undefined) {
        return;
      }
      const final = isFinalFailure(job, error);
      // Only the machine code is logged: error messages may quote external data.
      logger.warn(
        {
          queue: queueName,
          job: job.name,
          jobId: job.id,
          attempt: job.attemptsMade,
          errorCode: jobErrorCode(error),
          final,
        },
        final ? "Job failed for good" : "Job failed, will retry",
      );
      if (!final) {
        return;
      }
      reportError(error);
      recordDeadLetter(queues, job, error).catch((deadLetterError: unknown) => {
        logger.error(
          { queue: queueName, jobId: job.id, errorCode: jobErrorCode(deadLetterError) },
          "Could not record a dead letter",
        );
        reportError(deadLetterError);
      });
    });

    worker.on("error", (error) => {
      logger.error({ queue: queueName, errorCode: jobErrorCode(error) }, "Worker error");
    });

    return worker;
  });

  return {
    async close() {
      await Promise.all(workers.map((worker) => worker.close()));
    },
  };
}

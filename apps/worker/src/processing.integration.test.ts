import {
  buildJobId,
  cleanupOAuthRequestsJob,
  defineJob,
  JOB_SCHEDULES,
  QUEUE_NAMES,
  rateLimitKey,
  type JobDefinition,
  type RetryPolicy,
} from "@bystro/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  JobRegistry,
  PermanentJobError,
  recordDeadLetter,
  startWorkers,
  type Workers,
} from "./processing";
import { enqueue, registerSchedules } from "./queues";
import { createRateLimiter } from "./rate-limiter";
import { createTestQueues, eventually, silentLogger, type TestQueues } from "./test/redis";

const fastRetry: RetryPolicy = { attempts: 3, baseDelayMs: 20, maxDelayMs: 50, jitter: 0 };
const payloadSchema = z.strictObject({ connectionId: z.uuid() });
type Payload = z.infer<typeof payloadSchema>;

const testJob = (name: string, retry: RetryPolicy = fastRetry): JobDefinition<Payload> =>
  defineJob({ name, queue: QUEUE_NAMES.sync, schema: payloadSchema, retry });

const payload: Payload = { connectionId: "0b0e8a52-5f0c-4d6e-9d57-0e6f0a5f3c11" };

let test: TestQueues;
let workers: Workers | undefined;
let reported: unknown[];

beforeEach(() => {
  test = createTestQueues();
  workers = undefined;
  reported = [];
});

afterEach(async () => {
  await workers?.close();
  await test.cleanup();
});

function run(registry: JobRegistry): void {
  workers = startWorkers({
    queues: test.queues,
    registry,
    logger: silentLogger,
    concurrency: 5,
    reportError: (error) => reported.push(error),
  });
}

describe("retries", () => {
  it("a job that fails twice completes on the third attempt", async () => {
    const job = testJob("test.flaky");
    const attempts: number[] = [];
    run(
      new JobRegistry().register(job, async ({ attempt }) => {
        attempts.push(attempt);
        if (attempt < 3) {
          throw new Error("temporary outage");
        }
      }),
    );

    const jobId = buildJobId("test", "flaky");
    await enqueue(test.queues, job, payload, { jobId });

    await eventually(async () => {
      expect(await (await test.queues.processed.sync.getJob(jobId))?.getState()).toBe("completed");
    });
    expect(attempts).toEqual([1, 2, 3]);
    expect(await test.queues.deadLetter.getJobCounts()).toMatchObject({ waiting: 0 });
    expect(reported).toEqual([]);
  });
});

describe("idempotent job ids", () => {
  it("a job with the same id is not added or run twice", async () => {
    const job = testJob("test.once");
    let runs = 0;
    run(
      new JobRegistry().register(job, async () => {
        runs += 1;
      }),
    );

    const jobId = buildJobId("sync", "fakturoid", payload.connectionId, "2026-10-08T07");
    expect(await enqueue(test.queues, job, payload, { jobId })).toBe(true);
    expect(await enqueue(test.queues, job, payload, { jobId })).toBe(false);

    await eventually(async () => {
      expect(await (await test.queues.processed.sync.getJob(jobId))?.getState()).toBe("completed");
    });
    // Also after it finished: the id stays taken while the job is kept.
    expect(await enqueue(test.queues, job, payload, { jobId })).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(runs).toBe(1);
    expect(await test.queues.processed.sync.getJobCountByTypes("completed")).toBe(1);
  });

  it("refuses a payload that does not match the job's schema", async () => {
    const job = testJob("test.strict");
    const bad = { connectionId: payload.connectionId, accessToken: "secret" } as Payload;
    await expect(enqueue(test.queues, job, bad, { jobId: "test.strict" })).rejects.toThrow();
    expect(await test.queues.processed.sync.getJobCountByTypes("waiting", "delayed")).toBe(0);
  });
});

describe("dead letters", () => {
  it("a job that runs out of attempts ends in the dead-letter queue exactly once", async () => {
    const job = testJob("test.broken");
    let runs = 0;
    run(
      new JobRegistry().register(job, async () => {
        runs += 1;
        throw Object.assign(new Error("401 for petr@dvorak-interiery.cz"), { code: "http_401" });
      }),
    );

    const jobId = buildJobId("test", "broken");
    await enqueue(test.queues, job, payload, { jobId });

    await eventually(async () => {
      expect(await test.queues.deadLetter.getJobCountByTypes("waiting")).toBe(1);
    });
    expect(runs).toBe(3);

    const failed = await test.queues.processed.sync.getJob(jobId);
    expect(await failed?.getState()).toBe("failed");

    const [entry] = await test.queues.deadLetter.getJobs(["waiting"]);
    expect(entry?.data).toMatchObject({
      queue: "sync",
      name: "test.broken",
      jobId,
      data: payload,
      attemptsMade: 3,
      errorCode: "http_401",
    });
    // The error text may quote external data; only the code is kept.
    expect(JSON.stringify(entry?.data)).not.toContain("dvorak");
    expect(reported).toHaveLength(1);

    // Recording the same failure again (e.g. a repeated event) keeps a single entry.
    if (failed === undefined) {
      throw new Error("The failed job should still exist.");
    }
    await recordDeadLetter(test.queues, failed, new Error("again"));
    expect(await test.queues.deadLetter.getJobCountByTypes("waiting")).toBe(1);
  });

  it("a permanent error skips the remaining attempts", async () => {
    const job = testJob("test.revoked");
    let runs = 0;
    run(
      new JobRegistry().register(job, async () => {
        runs += 1;
        throw new PermanentJobError("reauth_required");
      }),
    );

    await enqueue(test.queues, job, payload, { jobId: "test.revoked" });

    await eventually(async () => {
      expect(await test.queues.deadLetter.getJobCountByTypes("waiting")).toBe(1);
    });
    const [entry] = await test.queues.deadLetter.getJobs(["waiting"]);
    expect(entry?.data).toMatchObject({ errorCode: "reauth_required", attemptsMade: 1 });
    expect(runs).toBe(1);
  });

  it("unknown jobs and malformed payloads are not retried", async () => {
    const job = testJob("test.known");
    run(new JobRegistry().register(job, async () => {}));

    // Written straight to Redis, as a buggy or malicious producer would.
    const queue = test.queues.processed.sync;
    await queue.add("test.unknown", payload, { jobId: "unknown-1", attempts: 3 });
    await queue.add("test.known", { connectionId: "not-a-uuid" }, { jobId: "bad-1", attempts: 3 });

    await eventually(async () => {
      expect(await test.queues.deadLetter.getJobCountByTypes("waiting")).toBe(2);
    });
    const entries = await test.queues.deadLetter.getJobs(["waiting"]);
    expect(entries.map((entry) => entry.data.errorCode).sort()).toEqual([
      "invalid_payload",
      "unknown_job",
    ]);
    expect(entries.every((entry) => entry.data.attemptsMade === 1)).toBe(true);
  });
});

describe("rate limiter", () => {
  const limit = { max: 2, windowMs: 400 };

  it("lets through at most the limit per window and says how long to wait", async () => {
    const limiter = createRateLimiter(test.queues.connection, test.queues.prefix);
    const key = rateLimitKey("fio", "conn-1");

    expect(await limiter.acquire(key, limit)).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(await limiter.acquire(key, limit)).toEqual({ allowed: true, retryAfterMs: 0 });
    const refused = await limiter.acquire(key, limit);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterMs).toBeGreaterThan(0);
    expect(refused.retryAfterMs).toBeLessThanOrEqual(limit.windowMs);

    // Another connection of the same provider has its own budget.
    expect((await limiter.acquire(rateLimitKey("fio", "conn-2"), limit)).allowed).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, limit.windowMs + 50));
    expect((await limiter.acquire(key, limit)).allowed).toBe(true);
  });

  it("a rate-limited job is postponed without spending an attempt", async () => {
    // One attempt only: if postponing counted as a failure, the third job would be dead.
    const job = testJob("test.limited", { ...fastRetry, attempts: 1 });
    const limiter = createRateLimiter(test.queues.connection, test.queues.prefix);
    const finishedAt: number[] = [];
    run(
      new JobRegistry().register(job, async () => {
        await limiter.require(rateLimitKey("fakturoid"), limit);
        finishedAt.push(Date.now());
      }),
    );

    const ids = ["a", "b", "c"].map((suffix) => buildJobId("test", "limited", suffix));
    const startedAt = Date.now();
    for (const jobId of ids) {
      await enqueue(test.queues, job, payload, { jobId });
    }

    await eventually(async () => {
      expect(await test.queues.processed.sync.getJobCountByTypes("completed")).toBe(3);
    });
    expect(finishedAt).toHaveLength(3);
    // Two ran at once; the third had to wait for the next window.
    expect(Math.max(...finishedAt) - startedAt).toBeGreaterThanOrEqual(limit.windowMs - 50);
    expect(await test.queues.deadLetter.getJobCountByTypes("waiting")).toBe(0);
    for (const jobId of ids) {
      expect((await test.queues.processed.sync.getJob(jobId))?.attemptsMade).toBe(1);
    }
  });
});

describe("schedules", () => {
  it("registering twice keeps one schedule per id, planned in Europe/Prague", async () => {
    await registerSchedules(test.queues);
    await registerSchedules(test.queues);

    const schedulers = await test.queues.processed.scheduled.getJobSchedulers();
    expect(schedulers).toHaveLength(JOB_SCHEDULES.length);
    expect(schedulers[0]).toMatchObject({
      key: "cleanup-oauth-requests",
      name: cleanupOAuthRequestsJob.name,
      pattern: "30 3 * * *",
      tz: "Europe/Prague",
    });
    // Exactly one upcoming run is waiting, not one per registration.
    expect(await test.queues.processed.scheduled.getJobCountByTypes("delayed")).toBe(1);
  });

  it("removes schedules that are no longer listed", async () => {
    await registerSchedules(test.queues, [
      ...JOB_SCHEDULES,
      { id: "retired-job", pattern: "0 7 * * *", job: cleanupOAuthRequestsJob },
    ]);
    expect(await test.queues.processed.scheduled.getJobSchedulers()).toHaveLength(2);

    await registerSchedules(test.queues);

    const schedulers = await test.queues.processed.scheduled.getJobSchedulers();
    expect(schedulers.map((scheduler) => scheduler.key)).toEqual(["cleanup-oauth-requests"]);
  });
});

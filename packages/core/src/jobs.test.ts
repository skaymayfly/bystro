import { describe, expect, it } from "vitest";

import {
  buildJobId,
  cleanupOAuthRequestsJob,
  decideRateLimit,
  DEFAULT_RETRY_POLICY,
  InvalidJobIdError,
  JOB_SCHEDULES,
  jobErrorCode,
  PROCESSED_QUEUES,
  QUEUE_NAMES,
  rateLimitKey,
  retryDelayMs,
  sanitizeJobIdPart,
  SCHEDULE_TIME_ZONE,
  type RetryPolicy,
} from "./jobs";

describe("queues", () => {
  it("has the three worked queues and a dead-letter queue", () => {
    expect(PROCESSED_QUEUES).toEqual(["sync", "actions", "scheduled"]);
    expect(QUEUE_NAMES.deadLetter).toBe("dead-letter");
  });
});

describe("retryDelayMs", () => {
  const policy: RetryPolicy = { attempts: 5, baseDelayMs: 1_000, maxDelayMs: 6_000, jitter: 0 };

  it("doubles with every failed attempt", () => {
    expect(retryDelayMs(policy, 1)).toBe(1_000);
    expect(retryDelayMs(policy, 2)).toBe(2_000);
    expect(retryDelayMs(policy, 3)).toBe(4_000);
  });

  it("never exceeds the maximum, however many attempts there were", () => {
    expect(retryDelayMs(policy, 4)).toBe(6_000);
    expect(retryDelayMs(policy, 500)).toBe(6_000);
  });

  it("takes jitter off the top and is deterministic for a given random source", () => {
    const jittered = { ...policy, jitter: 0.5 };
    expect(retryDelayMs(jittered, 2, () => 0)).toBe(2_000);
    expect(retryDelayMs(jittered, 2, () => 0.5)).toBe(1_500);
    expect(retryDelayMs(jittered, 2, () => 0.999)).toBeGreaterThanOrEqual(1_000);
  });

  it("rejects attempt counts that make no sense", () => {
    expect(() => retryDelayMs(policy, 0)).toThrow(RangeError);
    expect(() => retryDelayMs(policy, 1.5)).toThrow(RangeError);
  });

  it("defaults to three attempts", () => {
    expect(DEFAULT_RETRY_POLICY.attempts).toBe(3);
  });
});

describe("buildJobId", () => {
  const connectionId = "0b0e8a52-5f0c-4d6e-9d57-0e6f0a5f3c11";

  it("gives the same id for the same parts", () => {
    const id = buildJobId("sync", "fakturoid", connectionId, "2026-10-08T07");
    expect(id).toBe(`sync.fakturoid.${connectionId}.2026-10-08T07`);
    expect(buildJobId("sync", "fakturoid", connectionId, "2026-10-08T07")).toBe(id);
  });

  it("refuses characters the queue library cannot store in an id", () => {
    expect(() => buildJobId("sync", "a:b")).toThrow(InvalidJobIdError);
    expect(() => buildJobId("sync", "")).toThrow(InvalidJobIdError);
    expect(() => buildJobId("sync", "with space")).toThrow(InvalidJobIdError);
    expect(() => buildJobId()).toThrow(InvalidJobIdError);
  });

  it("refuses ids made of digits only and ids that are too long", () => {
    expect(() => buildJobId("12345")).toThrow(InvalidJobIdError);
    expect(buildJobId("job-12345")).toBe("job-12345");
    expect(() => buildJobId("a".repeat(201))).toThrow(InvalidJobIdError);
  });
});

describe("sanitizeJobIdPart", () => {
  it("replaces everything an id may not contain", () => {
    expect(sanitizeJobIdPart("repeat:cleanup:1791400000000")).toBe("repeat_cleanup_1791400000000");
    expect(buildJobId("dlq", sanitizeJobIdPart("a b:c/ž"))).toBe("dlq.a_b_c__");
    expect(sanitizeJobIdPart("")).toBe("_");
  });
});

describe("job definitions and schedules", () => {
  it("accepts only an empty payload for the OAuth cleanup", () => {
    expect(cleanupOAuthRequestsJob.schema.safeParse({}).success).toBe(true);
    expect(cleanupOAuthRequestsJob.schema.safeParse({ token: "x" }).success).toBe(false);
    expect(cleanupOAuthRequestsJob.queue).toBe("scheduled");
  });

  it("plans in Czech local time with unique schedule ids", () => {
    expect(SCHEDULE_TIME_ZONE).toBe("Europe/Prague");
    const ids = JOB_SCHEDULES.map((schedule) => schedule.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(JOB_SCHEDULES.every((schedule) => schedule.job.queue === "scheduled")).toBe(true);
  });
});

describe("decideRateLimit", () => {
  const limit = { max: 2, windowMs: 30_000 };

  it("allows calls up to the limit", () => {
    expect(decideRateLimit(limit, 1, 30_000)).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(decideRateLimit(limit, 2, 12_000)).toEqual({ allowed: true, retryAfterMs: 0 });
  });

  it("refuses the call over the limit and says when the window ends", () => {
    expect(decideRateLimit(limit, 3, 12_000)).toEqual({ allowed: false, retryAfterMs: 12_000 });
  });

  it("falls back to a whole window when the remaining time is unknown or too long", () => {
    expect(decideRateLimit(limit, 3, -1)).toEqual({ allowed: false, retryAfterMs: 30_000 });
    expect(decideRateLimit(limit, 3, 90_000)).toEqual({ allowed: false, retryAfterMs: 30_000 });
  });
});

describe("rateLimitKey", () => {
  it("is per provider, optionally per connection", () => {
    expect(rateLimitKey("fio")).toBe("fio");
    expect(rateLimitKey("fio", "conn-1")).toBe("fio.conn-1");
    expect(() => rateLimitKey("fio", "a:b")).toThrow(InvalidJobIdError);
  });
});

describe("jobErrorCode", () => {
  it("prefers a tidy code, then the class name", () => {
    expect(jobErrorCode(Object.assign(new Error("boom"), { code: "http_401" }))).toBe("http_401");
    expect(jobErrorCode(new TypeError("boom"))).toBe("TypeError");
  });

  it("never returns the message or an untidy code", () => {
    const error = Object.assign(new Error("IBAN CZ65 0800 0000 1920 0014 5399"), {
      code: "contains spaces and a secret",
    });
    expect(jobErrorCode(error)).toBe("Error");
    expect(jobErrorCode("just a string")).toBe("unknown_error");
    expect(jobErrorCode(null)).toBe("unknown_error");
  });
});

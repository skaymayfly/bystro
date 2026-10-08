import { EnvError } from "@bystro/db";
import { describe, expect, it } from "vitest";

import { readWorkerEnv } from "./env";
import {
  cleanupOAuthRequestsHandler,
  OAUTH_REQUEST_RETENTION_MS,
} from "./jobs/cleanup-oauth-requests";
import { JobRegistry } from "./processing";
import { silentLogger } from "./test/redis";

describe("readWorkerEnv", () => {
  const valid = {
    REDIS_URL: "redis://localhost:6379",
    DATABASE_URL: "postgresql://bystro:bystro@localhost:5432/bystro",
  };

  it("reads the connection strings and defaults the concurrency", () => {
    expect(readWorkerEnv(valid)).toEqual({
      redisUrl: valid.REDIS_URL,
      databaseUrl: valid.DATABASE_URL,
      concurrency: 5,
    });
    expect(readWorkerEnv({ ...valid, WORKER_CONCURRENCY: "12" }).concurrency).toBe(12);
  });

  it("refuses to start without Redis or the database", () => {
    expect(() => readWorkerEnv({ ...valid, REDIS_URL: undefined })).toThrow(EnvError);
    expect(() => readWorkerEnv({ ...valid, REDIS_URL: "http://localhost" })).toThrow(EnvError);
    expect(() => readWorkerEnv({ ...valid, DATABASE_URL: "" })).toThrow(EnvError);
  });

  it("refuses a nonsensical concurrency", () => {
    for (const value of ["0", "-1", "2.5", "many", "500"]) {
      expect(() => readWorkerEnv({ ...valid, WORKER_CONCURRENCY: value })).toThrow(EnvError);
    }
  });

  it("never puts the value into the error message", () => {
    const secretUrl = "https://user:tajne-heslo@redis.example";
    expect(() => readWorkerEnv({ ...valid, REDIS_URL: secretUrl })).toThrow(
      expect.not.objectContaining({ message: expect.stringContaining("tajne-heslo") }),
    );
  });
});

describe("JobRegistry", () => {
  it("refuses two handlers for one job name", async () => {
    const { cleanupOAuthRequestsJob } = await import("@bystro/core");
    const registry = new JobRegistry().register(cleanupOAuthRequestsJob, async () => {});
    expect(() => registry.register(cleanupOAuthRequestsJob, async () => {})).toThrow(
      /already registered/,
    );
    expect(registry.get("something.else")).toBeUndefined();
  });
});

describe("cleanupOAuthRequestsHandler", () => {
  it("deletes requests that expired more than a day ago", async () => {
    const now = new Date("2026-10-08T01:30:00Z");
    const cutOffs: Date[] = [];
    const handler = cleanupOAuthRequestsHandler({
      now: () => now,
      deleteExpiredBefore: async (moment) => {
        cutOffs.push(moment);
        return 4;
      },
    });

    await handler({ data: {}, jobId: "job-1", attempt: 1, logger: silentLogger });

    expect(OAUTH_REQUEST_RETENTION_MS).toBe(24 * 60 * 60 * 1000);
    expect(cutOffs).toEqual([new Date("2026-10-07T01:30:00Z")]);
  });
});

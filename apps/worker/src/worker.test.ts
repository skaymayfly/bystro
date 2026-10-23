import { randomBytes } from "node:crypto";

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
  const key = randomBytes(32);
  const valid = {
    REDIS_URL: "redis://localhost:6379",
    DATABASE_URL: "postgresql://bystro:bystro@localhost:5432/bystro",
    ENCRYPTION_KEY: key.toString("base64"),
  };
  const fakturoid = {
    FAKTUROID_CLIENT_ID: "client-id",
    FAKTUROID_CLIENT_SECRET: "client-secret-value",
    INTEGRATIONS_CONTACT_EMAIL: "vyvoj@bystro.example",
  };

  it("reads the connection strings and defaults the concurrency", () => {
    expect(readWorkerEnv(valid)).toEqual({
      redisUrl: valid.REDIS_URL,
      databaseUrl: valid.DATABASE_URL,
      encryptionKey: key,
      concurrency: 5,
      providers: { fakturoid: null, idoklad: null, gmail: null },
    });
    expect(readWorkerEnv({ ...valid, WORKER_CONCURRENCY: "12" }).concurrency).toBe(12);
  });

  it("needs the key that decrypts tokens", () => {
    expect(() => readWorkerEnv({ ...valid, ENCRYPTION_KEY: undefined })).toThrow(EnvError);
    expect(() => readWorkerEnv({ ...valid, ENCRYPTION_KEY: "short" })).toThrow(EnvError);
  });

  it("reads Fakturoid when it is configured completely, and keeps the secret out of sight", () => {
    const env = readWorkerEnv({ ...valid, ...fakturoid });
    expect(env.providers.fakturoid).toMatchObject({
      clientId: "client-id",
      userAgent: "Bystro (vyvoj@bystro.example)",
    });
    expect(JSON.stringify(env.providers)).not.toContain("client-secret-value");
    expect(env.providers.fakturoid?.clientSecret.reveal()).toBe("client-secret-value");
  });

  it("reads iDoklad when both of its variables are set, and refuses a half of them", () => {
    const env = readWorkerEnv({
      ...valid,
      IDOKLAD_CLIENT_ID: " idoklad-id ",
      IDOKLAD_CLIENT_SECRET: "idoklad-secret-value",
    });
    expect(env.providers.idoklad?.clientId).toBe("idoklad-id");
    expect(env.providers.idoklad?.clientSecret.reveal()).toBe("idoklad-secret-value");
    expect(JSON.stringify(env.providers)).not.toContain("idoklad-secret-value");

    expect(() => readWorkerEnv({ ...valid, IDOKLAD_CLIENT_ID: "idoklad-id" })).toThrow(
      /IDOKLAD_CLIENT_ID and IDOKLAD_CLIENT_SECRET/,
    );
  });

  it("refuses a half-configured Fakturoid or a contact that is not an e-mail", () => {
    expect(() => readWorkerEnv({ ...valid, ...fakturoid, FAKTUROID_CLIENT_SECRET: "" })).toThrow(
      EnvError,
    );
    expect(() =>
      readWorkerEnv({ ...valid, ...fakturoid, INTEGRATIONS_CONTACT_EMAIL: "nobody" }),
    ).toThrow(EnvError);
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

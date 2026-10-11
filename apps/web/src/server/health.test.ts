import { describe, expect, it } from "vitest";

import { checkHealth } from "./health";

const up = async () => true;
const down = async () => false;
const failing = async () => {
  throw new Error("connect ECONNREFUSED postgresql://bystro:hunter2@db.internal:5432/bystro");
};
const hanging = () => new Promise<boolean>(() => {});

describe("checkHealth", () => {
  it("is ok when the database and Redis both answer", async () => {
    expect(await checkHealth({ database: up, redis: up, worker: up })).toEqual({
      status: "ok",
      database: "ok",
      redis: "ok",
      worker: "ok",
    });
  });

  it("reports a missing worker without failing the web app's own health", async () => {
    expect(await checkHealth({ database: up, redis: up, worker: down })).toEqual({
      status: "ok",
      database: "ok",
      redis: "ok",
      worker: "down",
    });
  });

  it("reports which part is down", async () => {
    expect(await checkHealth({ database: down, redis: up, worker: up })).toEqual({
      status: "down",
      database: "down",
      redis: "ok",
      worker: "ok",
    });
    expect(await checkHealth({ database: up, redis: down, worker: down })).toEqual({
      status: "down",
      database: "ok",
      redis: "down",
      worker: "down",
    });
  });

  it("treats a failing check as down and never leaks the error", async () => {
    const report = await checkHealth({ database: failing, redis: failing, worker: failing });

    expect(report).toEqual({ status: "down", database: "down", redis: "down", worker: "down" });
    expect(JSON.stringify(report)).not.toMatch(/hunter2|postgresql|ECONNREFUSED|internal/);
  });

  it("treats a check that never answers as down after the timeout", async () => {
    const started = Date.now();
    const report = await checkHealth({ database: hanging, redis: up, worker: hanging }, 50);

    expect(report).toEqual({ status: "down", database: "down", redis: "ok", worker: "down" });
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

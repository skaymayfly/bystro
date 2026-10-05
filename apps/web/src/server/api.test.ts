import { describe, expect, it } from "vitest";

import { isSameOrigin, json } from "./api";

const request = (origin?: string) =>
  new Request("http://localhost:3000/api/organizations", {
    method: "POST",
    headers: origin === undefined ? {} : { origin },
  });

describe("isSameOrigin", () => {
  it("accepts the app's own origin", () => {
    expect(isSameOrigin(request("http://localhost:3000"), "http://localhost:3000")).toBe(true);
    expect(isSameOrigin(request("https://app.bystro.cz"), "https://app.bystro.cz/")).toBe(true);
  });

  it("rejects other origins, including look-alikes", () => {
    for (const origin of [
      "https://evil.example",
      "http://localhost:3001",
      "https://localhost:3000",
      "http://localhost:3000.evil.example",
      "null",
      "",
    ]) {
      expect(isSameOrigin(request(origin), "http://localhost:3000"), origin).toBe(false);
    }
  });

  it("rejects requests without an Origin header", () => {
    expect(isSameOrigin(request(), "http://localhost:3000")).toBe(false);
  });
});

describe("json", () => {
  it("is never cached", async () => {
    const response = json({ ok: true }, 201);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true });
  });
});

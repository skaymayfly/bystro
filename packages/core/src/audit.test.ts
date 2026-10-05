import { describe, expect, it } from "vitest";

import { sanitizeAuditMetadata } from "./audit";
import { REDACTED } from "./redaction";

describe("sanitizeAuditMetadata", () => {
  it("keeps harmless values untouched", () => {
    const metadata = { invoiceId: "inv_1", count: 3, done: true, note: null, tags: ["a", "b"] };
    expect(sanitizeAuditMetadata(metadata)).toEqual(metadata);
  });

  it("redacts values under sensitive keys, whatever their casing or naming style", () => {
    const result = sanitizeAuditMetadata({
      accessToken: "ya29.abc",
      refresh_token: "1//xyz",
      password: "hunter2",
      Authorization: "Bearer abc",
      apiKey: "sk-123",
      api_key: "sk-456",
      clientSecret: "shh",
      iban: "CZ6508000000192000145399",
      email: "jan@example.cz",
      contactEmail: "jana@example.cz",
      "e-mail": "x@example.cz",
      accountNumber: "19-2000145399/0800",
      cookie: "session=abc",
    });
    for (const value of Object.values(result)) {
      expect(value).toBe(REDACTED);
    }
  });

  it("redacts inside nested objects and arrays", () => {
    const result = sanitizeAuditMetadata({
      provider: "fakturoid",
      connection: { id: "c1", credentials: { accessToken: "abc" } },
      recipients: [{ name: "Novák", email: "novak@example.cz" }],
    });
    expect(result).toEqual({
      provider: "fakturoid",
      connection: { id: "c1", credentials: REDACTED },
      recipients: [{ name: "Novák", email: REDACTED }],
    });
    expect(JSON.stringify(result)).not.toContain("abc");
    expect(JSON.stringify(result)).not.toContain("novak@example.cz");
  });

  it("returns plain JSON: dates, bigints and unsupported values are converted or dropped", () => {
    const result = sanitizeAuditMetadata({
      at: new Date("2026-10-05T07:00:00.000Z"),
      amountMinor: 123_456_789_012_345_678n,
      missing: undefined,
      callback: () => "x",
      notANumber: Number.NaN,
      list: [undefined, 1],
    });
    expect(result).toEqual({
      at: "2026-10-05T07:00:00.000Z",
      amountMinor: "123456789012345678",
      notANumber: null,
      list: [null, 1],
    });
  });

  it("does not modify the input", () => {
    const metadata = { nested: { token: "abc" } };
    sanitizeAuditMetadata(metadata);
    expect(metadata.nested.token).toBe("abc");
  });

  it("stops at a maximum depth instead of recursing forever", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    const result = sanitizeAuditMetadata(cyclic);
    expect(JSON.stringify(result)).toContain(REDACTED);
  });
});

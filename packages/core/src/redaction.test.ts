import { describe, expect, it } from "vitest";

import { AMOUNT_KEY, redactDeep, REDACTED, redactText, SENSITIVE_KEY } from "./redaction";

describe("redactText", () => {
  it("removes e-mail addresses", () => {
    expect(redactText("Upomínka pro jan.novak+faktury@example.cz odešla")).toBe(
      `Upomínka pro ${REDACTED} odešla`,
    );
    expect(redactText("kontakt: Žaneta@firma-dvořák.cz")).not.toContain("@");
  });

  it("removes IBANs with and without spaces and Czech account numbers", () => {
    expect(redactText("IBAN CZ6508000000192000145399")).toBe(`IBAN ${REDACTED}`);
    expect(redactText("IBAN CZ65 0800 0000 1920 0014 5399 ok")).toBe(`IBAN ${REDACTED} ok`);
    expect(redactText("účet 19-2000145399/0800")).toBe(`účet ${REDACTED}`);
    expect(redactText("účet 2000145399/0800")).toBe(`účet ${REDACTED}`);
  });

  it("removes amounts with a currency", () => {
    for (const text of ["12 500 Kč", "1 234,50 CZK", "−74 000 Kč", "99 EUR", "€ 99", "$1,200.50"]) {
      const result = redactText(`Platba ${text} dorazila`);
      expect(result, text).toBe(`Platba ${REDACTED} dorazila`);
    }
  });

  it("removes bearer credentials", () => {
    expect(redactText("Authorization: Bearer abc.def-123_xyz")).toBe(`Authorization: ${REDACTED}`);
  });

  it("leaves harmless text alone", () => {
    for (const text of [
      "Sync finished: 8 invoices in 1200 ms",
      "Invoice FV-2026-0142 is 12 days overdue",
      "organization 3f1c2a9e-0b7d-4c1e-9a55-2f6d7e8b9c10 created",
      "GET /api/companies/lookup 200",
    ]) {
      expect(redactText(text)).toBe(text);
    }
  });
});

describe("redactDeep", () => {
  const logOptions = { keys: [SENSITIVE_KEY, AMOUNT_KEY], scrubText: true };

  it("replaces values under sensitive and amount keys at any depth", () => {
    const result = redactDeep(
      {
        provider: "fio",
        accessToken: "secret-token",
        account: { iban: "CZ6508000000192000145399", balance: 18640000 },
        invoices: [{ id: "FV-1", amountMinor: 11200000, clientEmail: "a@example.cz" }],
      },
      logOptions,
    );

    expect(result).toEqual({
      provider: "fio",
      accessToken: REDACTED,
      account: { iban: REDACTED, balance: REDACTED },
      invoices: [{ id: "FV-1", amountMinor: REDACTED, clientEmail: REDACTED }],
    });
  });

  it("scrubs sensitive substrings in string values under neutral keys", () => {
    const result = redactDeep(
      { note: "poslat na jan@example.cz, dluží 5 000 Kč", items: ["CZ6508000000192000145399"] },
      logOptions,
    );
    expect(JSON.stringify(result)).not.toMatch(/jan@example|5 000|CZ65/);
  });

  it("does not scrub text unless asked to", () => {
    expect(redactDeep({ note: "jan@example.cz" }, { keys: [SENSITIVE_KEY] })).toEqual({
      note: "jan@example.cz",
    });
  });

  it("turns errors into scrubbed plain objects, including their cause", () => {
    const error = new Error("Request to jan@example.cz failed with Bearer abc123", {
      cause: new TypeError("token re_live_123 rejected for 19-2000145399/0800"),
    });
    const result = redactDeep({ err: error }, logOptions) as {
      err: { type: string; message: string; stack: string; cause: { message: string } };
    };

    expect(result.err.type).toBe("Error");
    expect(result.err.message).toBe(`Request to ${REDACTED} failed with ${REDACTED}`);
    expect(result.err.cause.message).not.toContain("19-2000145399/0800");
    expect(JSON.stringify(result)).not.toContain("jan@example.cz");
    expect(result.err.stack).toContain("redaction.test");
  });

  it("returns plain JSON and never mutates the input", () => {
    const input = { at: new Date("2026-10-05T07:00:00Z"), big: 5n, skip: undefined, password: "x" };
    expect(redactDeep(input, logOptions)).toEqual({
      at: "2026-10-05T07:00:00.000Z",
      big: "5",
      password: REDACTED,
    });
    expect(input.password).toBe("x");
  });

  it("cuts off cycles and handles primitives at the top level", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    expect(JSON.stringify(redactDeep(cyclic, logOptions))).toContain(REDACTED);
    expect(redactDeep("jan@example.cz", logOptions)).toBe(REDACTED);
    expect(redactDeep(undefined, logOptions)).toBeNull();
  });
});

import { inspect } from "node:util";

import { describe, expect, it } from "vitest";

import { Secret } from "./secret";

const VALUE = "ya29.very-secret-access-token";

describe("Secret", () => {
  it("gives the value only through reveal()", () => {
    expect(new Secret(VALUE).reveal()).toBe(VALUE);
  });

  it("never shows the value when serialized, printed or inspected", () => {
    const secret = new Secret(VALUE);
    const outputs = [
      JSON.stringify(secret),
      JSON.stringify({ tokens: { accessToken: secret } }),
      String(secret),
      `${secret}`,
      inspect(secret),
      inspect({ nested: [secret] }, { depth: 5 }),
      Object.keys(secret).join(","),
      JSON.stringify(Object.entries(secret)),
    ];

    for (const output of outputs) {
      expect(output).not.toContain(VALUE);
    }
    expect(JSON.stringify({ accessToken: secret })).toBe('{"accessToken":"[redacted]"}');
  });

  it("does not expose the value as a property", () => {
    const secret = new Secret(VALUE) as unknown as Record<string, unknown>;
    expect(secret.value).toBeUndefined();
    expect(Object.getOwnPropertyNames(secret)).toEqual([]);
  });

  it("survives structured cloning attempts without leaking", () => {
    // Private fields are not cloneable; whatever comes out must not contain the value.
    let cloned: unknown;
    try {
      cloned = structuredClone(new Secret(VALUE));
    } catch {
      cloned = null;
    }
    expect(JSON.stringify(cloned)).not.toContain(VALUE);
  });
});

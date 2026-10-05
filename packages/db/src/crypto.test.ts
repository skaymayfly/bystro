import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decrypt, DecryptionError, encrypt, parseEncryptionKey } from "./crypto";

const key = randomBytes(32);
const otherKey = randomBytes(32);

/** Flips one bit in the given dot-separated part of an encrypted payload. */
function tamper(payload: string, partIndex: number): string {
  const parts = payload.split(".");
  const bytes = Buffer.from(parts[partIndex] ?? "", "base64url");
  bytes[0] = (bytes[0] ?? 0) ^ 0x01;
  parts[partIndex] = bytes.toString("base64url");
  return parts.join(".");
}

describe("encrypt / decrypt", () => {
  it("round-trips text, including Czech characters and the empty string", () => {
    for (const text of ["token-123", "Příliš žluťoučký kůň 🐎", "", "x".repeat(10_000)]) {
      expect(decrypt(encrypt(text, key), key)).toBe(text);
    }
  });

  it("does not contain the plaintext in the output", () => {
    expect(encrypt("super-secret-token", key)).not.toContain("super-secret-token");
  });

  it("uses a different IV for every encryption", () => {
    const payloads = Array.from({ length: 50 }, () => encrypt("same text", key));
    const ivs = new Set(payloads.map((payload) => payload.split(".")[1]));
    expect(ivs.size).toBe(50);
    expect(new Set(payloads).size).toBe(50);
  });

  it("fails with the wrong key", () => {
    const payload = encrypt("token-123", key);
    expect(() => decrypt(payload, otherKey)).toThrow(DecryptionError);
  });

  it("fails when the ciphertext, auth tag or IV is modified", () => {
    const payload = encrypt("token-123", key);
    for (const partIndex of [1, 2, 3]) {
      expect(() => decrypt(tamper(payload, partIndex), key)).toThrow(DecryptionError);
    }
  });

  it("rejects payloads in an unknown format", () => {
    const payload = encrypt("token-123", key);
    for (const bad of ["", "not-encrypted", payload.replace(/^v1/, "v2"), `${payload}.extra`]) {
      expect(() => decrypt(bad, key)).toThrow(DecryptionError);
    }
  });

  it("rejects a truncated auth tag", () => {
    const [version, iv, tag, ciphertext] = encrypt("token-123", key).split(".");
    const shortTag = Buffer.from(tag ?? "", "base64url")
      .subarray(0, 4)
      .toString("base64url");
    expect(() => decrypt([version, iv, shortTag, ciphertext].join("."), key)).toThrow(
      DecryptionError,
    );
  });

  it("refuses keys that are not 32 bytes", () => {
    expect(() => encrypt("x", randomBytes(16))).toThrow(/32 bytes/);
    expect(() => decrypt(encrypt("x", key), randomBytes(31))).toThrow(/32 bytes/);
  });

  it("never puts the key or the payload into error messages", () => {
    const payload = encrypt("token-123", key);
    try {
      decrypt(payload, otherKey);
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(payload);
      expect(message).not.toContain(otherKey.toString("base64"));
    }
  });
});

describe("parseEncryptionKey", () => {
  it("accepts 32 bytes encoded as base64", () => {
    expect(parseEncryptionKey(key.toString("base64")).equals(key)).toBe(true);
  });

  it("rejects keys of the wrong length", () => {
    expect(() => parseEncryptionKey(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
    expect(() => parseEncryptionKey("")).toThrow(/32 bytes/);
  });
});

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Thrown when a payload cannot be decrypted. The message never contains key or payload data. */
export class DecryptionError extends Error {
  override name = "DecryptionError";
}

/** Decodes a base64 key and checks that it is exactly 32 bytes (AES-256). */
export function parseEncryptionKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`Encryption key must be ${KEY_BYTES} bytes encoded as base64.`);
  }
  return key;
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Encryption key must be ${KEY_BYTES} bytes.`);
  }
}

/**
 * Encrypts text with AES-256-GCM using a fresh random IV.
 * Output: `v1.<iv>.<authTag>.<ciphertext>`, each part base64url. The version prefix
 * leaves room for key rotation or an algorithm change later.
 */
export function encrypt(plaintext: string, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, ...[iv, tag, ciphertext].map((part) => part.toString("base64url"))].join(".");
}

/** Decrypts a payload produced by {@link encrypt}. Throws {@link DecryptionError} on any failure. */
export function decrypt(payload: string, key: Buffer): string {
  assertKey(key);
  const parts = payload.split(".");
  const [version, ivPart, tagPart, ciphertextPart] = parts;
  if (
    parts.length !== 4 ||
    version !== VERSION ||
    ivPart === undefined ||
    tagPart === undefined ||
    ciphertextPart === undefined
  ) {
    throw new DecryptionError("Encrypted payload has an unknown format.");
  }
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new DecryptionError("Encrypted payload has an unknown format.");
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new DecryptionError("Decryption failed: wrong key or corrupted data.");
  }
}

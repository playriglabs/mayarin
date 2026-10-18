/**
 * Encryption for secrets the service must read back in the clear (SEC-12).
 *
 * A webhook signing secret cannot be hashed: delivery needs the secret itself to
 * sign with. What it can be is unreadable to someone holding only the database
 * (a dump, a stolen backup, a read-only credential). AES-256-GCM under a key
 * that lives in the service environment, not in the database.
 *
 * Stored as `enc:v1:<base64 iv|tag|ciphertext>`. A value without the prefix is
 * a row written before this existed and is returned as it is; every write
 * encrypts. Opening an encrypted value with no key throws rather than handing
 * the ciphertext on as if it were a secret.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

export class SecretBox {
  readonly #key: Buffer;

  constructor(key: string) {
    this.#key = createHash("sha256").update(`secret-box:${key}`).digest();
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
  }

  open(stored: string): string {
    if (!stored.startsWith(PREFIX)) return stored;
    const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.#key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  }
}

/** Opens a stored value when a box is configured; throws on an encrypted value when none is. */
export function openSecret(box: SecretBox | undefined, stored: string): string {
  if (box !== undefined) return box.open(stored);
  if (stored.startsWith(PREFIX)) {
    throw new Error("A stored secret is encrypted but no encryption key is configured");
  }
  return stored;
}

export function sealSecret(box: SecretBox | undefined, plain: string): string {
  return box === undefined ? plain : box.seal(plain);
}

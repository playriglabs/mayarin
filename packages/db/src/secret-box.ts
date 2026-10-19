/**
 * Encryption for secrets the service must read back in the clear (SEC-12).
 *
 * A webhook signing secret cannot be hashed: delivery needs the secret itself to
 * sign with. What it can be is unreadable to someone holding only the database
 * (a dump, a stolen backup, a read-only credential). AES-256-GCM under a key
 * that lives in the service environment, not in the database.
 *
 * Stored as `enc:v2:<key id>:<base64 iv|tag|ciphertext>`, where the key id is a
 * short fingerprint of the key. Every write uses the current key; a read finds
 * its key by that id among the current and the previous ones, so rotating means
 * setting the new key, keeping the old one as previous, rewriting the rows with
 * `isCurrent` false, then dropping the old key. A value that names a key the box
 * does not hold throws.
 *
 * `enc:v1:` rows (no key id, written before rotation existed) are tried against
 * each key in turn, and a value without any prefix is a row written before
 * encryption and is returned as it is. Opening an encrypted value with no key
 * throws rather than handing the ciphertext on as if it were a secret.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v";
const V1 = "enc:v1:";
const V2 = "enc:v2:";

interface Key {
  readonly id: string;
  readonly bytes: Buffer;
}

function derive(key: string): Key {
  const bytes = createHash("sha256").update(`secret-box:${key}`).digest();
  return { id: createHash("sha256").update(bytes).digest("hex").slice(0, 8), bytes };
}

function decrypt(key: Key, base64: string): string {
  const raw = Buffer.from(base64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key.bytes, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export class SecretBox {
  readonly #current: Key;
  readonly #previous: readonly Key[];

  constructor(key: string, previousKeys: readonly string[] = []) {
    this.#current = derive(key);
    this.#previous = previousKeys.map(derive);
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#current.bytes, iv);
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const sealed = Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
    return `${V2}${this.#current.id}:${sealed}`;
  }

  open(stored: string): string {
    if (stored.startsWith(V2)) {
      const [id, sealed] = stored.slice(V2.length).split(":");
      const key = [this.#current, ...this.#previous].find((candidate) => candidate.id === id);
      if (key === undefined || sealed === undefined) {
        throw new Error(`A stored secret is sealed under key ${id}, which is not configured`);
      }
      return decrypt(key, sealed);
    }
    if (!stored.startsWith(V1)) return stored;
    for (const key of [this.#current, ...this.#previous]) {
      try {
        return decrypt(key, stored.slice(V1.length));
      } catch {
        // Wrong key for this row; try the next.
      }
    }
    throw new Error("A stored secret is sealed under a key that is not configured");
  }

  /** False for plaintext, `enc:v1:` and a previous key: the rows a rotation still has to rewrite. */
  isCurrent(stored: string): boolean {
    return stored.startsWith(`${V2}${this.#current.id}:`);
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

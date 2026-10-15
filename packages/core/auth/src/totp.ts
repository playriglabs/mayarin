/**
 * Time-based one-time passwords (RFC 6238) for authenticator apps (SEC-15, SEC-16).
 *
 * SHA-1, six digits, thirty seconds: the parameters Google Authenticator and
 * every compatible app assume, so the QR is just `otpauth://` with a secret.
 * Pure functions over `node:crypto`; the clock is an argument.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** 160 random bits, base32, which is what authenticator apps accept as a key. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The time step a moment falls in. */
export function totpStepAt(now: Date): number {
  return Math.floor(now.getTime() / 1_000 / STEP_SECONDS);
}

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    ((hmac[offset + 1] ?? 0) << 16) |
    ((hmac[offset + 2] ?? 0) << 8) |
    (hmac[offset + 3] ?? 0);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * The step a code matches within one step either side of now, or undefined.
 *
 * The caller must reject a step it has already accepted: a code is good once,
 * and without that a shoulder-surfed code works for the rest of its window.
 */
export function matchTotp(secret: string, code: string, now: Date): number | undefined {
  if (!/^\d{6}$/.test(code)) return undefined;
  const current = totpStepAt(now);
  for (const step of [current, current - 1, current + 1]) {
    if (constantTimeEqual(totpCode(secret, step), code)) return step;
  }
  return undefined;
}

/** What goes in the QR. */
export function otpauthUri(options: {
  readonly secret: string;
  readonly account: string;
  readonly issuer: string;
}): string {
  const label = `${encodeURIComponent(options.issuer)}:${encodeURIComponent(options.account)}`;
  const params = new URLSearchParams({
    secret: options.secret,
    issuer: options.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Eight characters, ambiguous ones left out: typed in by hand once, at the worst time. */
export function newRecoveryCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let code = "";
  for (const byte of bytes) code += chars[byte % chars.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Recovery codes are stored hashed, like any other credential. */
export function hashRecoveryCode(code: string): string {
  return createHash("sha256")
    .update(`recovery:${code.replace(/[\s-]/g, "").toUpperCase()}`)
    .digest("hex");
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of text.toUpperCase().replace(/=+$/, "")) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new RangeError("Invalid base32 secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

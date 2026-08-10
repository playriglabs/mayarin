/**
 * Identifiers.
 *
 * IDs are prefixed ULIDs: `pi_01J8Z3K4M5N6P7Q8R9S0T1U2V3`. Two properties matter
 * for payment infrastructure — they sort by creation time (so ledger and event
 * logs read in order, and B-tree inserts stay local), and the prefix makes a
 * mis-routed ID obvious in a log line instead of silently querying the wrong
 * table.
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;
const RANDOM_BITS = 80n;
const MAX_RANDOM = (1n << RANDOM_BITS) - 1n;

export const ID_PREFIXES = {
  paymentIntent: "pi",
  clearingTransaction: "clr",
  clearingEvent: "evt",
  ledgerAccount: "lacc",
  ledgerTransaction: "ltxn",
  ledgerEntry: "lent",
  settlement: "stl",
  depositAddress: "dad",
  deposit: "dep",
  user: "usr",
  session: "ses",
  merchant: "mrc",
  merchantWallet: "wlt",
  walletChallenge: "wch",
  walletNonce: "wnc",
  product: "prd",
  paymentLink: "lnk",
  merchantSettingChange: "msc",
  refund: "rfd",
  webhookEndpoint: "whe",
  webhookDelivery: "whd",
  customer: "cus",
  apiKey: "mak",
} as const;

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

let lastTime = -1;
let lastRandom = 0n;

/** Generates a prefixed, lexicographically sortable, monotonic ULID. */
export function generateId(prefix: IdPrefix, now: number = Date.now()): string {
  return `${prefix}_${ulid(now)}`;
}

export function ulid(now: number = Date.now()): string {
  if (now === lastTime) {
    // Same millisecond: keep IDs strictly increasing by bumping the random part.
    lastRandom = lastRandom >= MAX_RANDOM ? randomBits() : lastRandom + 1n;
  } else {
    lastTime = now;
    lastRandom = randomBits();
  }
  return encodeTime(now) + encodeBase32(lastRandom, RANDOM_CHARS);
}

export function hasPrefix(id: string, prefix: IdPrefix): boolean {
  return id.startsWith(`${prefix}_`);
}

/** Extracts the creation timestamp encoded in a prefixed or bare ULID. */
export function timestampFromId(id: string): Date {
  const ulidPart = id.includes("_") ? id.slice(id.indexOf("_") + 1) : id;
  let time = 0n;
  for (const char of ulidPart.slice(0, TIME_CHARS)) {
    const value = ENCODING.indexOf(char);
    if (value === -1) throw new Error(`Invalid ULID character: "${char}"`);
    time = time * 32n + BigInt(value);
  }
  return new Date(Number(time));
}

function randomBits(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function encodeTime(now: number): string {
  if (!Number.isInteger(now) || now < 0) throw new Error(`Invalid timestamp: ${now}`);
  return encodeBase32(BigInt(now), TIME_CHARS);
}

function encodeBase32(value: bigint, length: number): string {
  let remaining = value;
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out = ENCODING.charAt(Number(remaining & 31n)) + out;
    remaining >>= 5n;
  }
  return out;
}

/**
 * Webhook signing: HMAC-SHA256 over `${timestamp}.${body}`.
 *
 * The header carries the timestamp it was signed with (`t=`) plus one `v1=`
 * signature per active secret. Verification recomputes from the received body
 * and the receiver's own clock bound, so a captured delivery cannot be
 * replayed outside the tolerance window and a tampered body never verifies.
 *
 * `verifyWebhook` is the function the SDK's verifier (#14) mirrors — it reads
 * nothing but its arguments.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_ID_HEADER = "webhook-id";
export const WEBHOOK_TIMESTAMP_HEADER = "webhook-timestamp";
export const WEBHOOK_SIGNATURE_HEADER = "webhook-signature";

/** Default bound on how old a delivery's timestamp may be, in seconds. */
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

export interface SignWebhookOptions {
  /** Current secret first; a rotation's previous secret after it. */
  readonly secrets: readonly string[];
  readonly timestamp: Date;
  readonly body: string;
}

/** Produces the `Webhook-Signature` header value: `t=<unix>,v1=<hex>[,v1=<hex>]`. */
export function signWebhook(options: SignWebhookOptions): string {
  const timestamp = unixSeconds(options.timestamp);
  const signatures = options.secrets.map(
    (secret) => `v1=${hmac(secret, `${timestamp}.${options.body}`)}`,
  );
  return [`t=${timestamp}`, ...signatures].join(",");
}

export interface VerifyWebhookOptions {
  readonly header: string;
  readonly body: string;
  /** Every secret the receiver holds; one match verifies. */
  readonly secrets: readonly string[];
  readonly now: Date;
  readonly toleranceSeconds?: number;
}

export function verifyWebhook(options: VerifyWebhookOptions): boolean {
  const parsed = parseSignatureHeader(options.header);
  if (parsed === undefined) return false;

  const tolerance = options.toleranceSeconds ?? WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS;
  if (Math.abs(unixSeconds(options.now) - parsed.timestamp) > tolerance) return false;

  const message = `${parsed.timestamp}.${options.body}`;
  return options.secrets.some((secret) => {
    const expected = hmac(secret, message);
    return parsed.signatures.some((candidate) => constantTimeEqual(candidate, expected));
  });
}

function parseSignatureHeader(
  header: string,
): { timestamp: number; signatures: readonly string[] } | undefined {
  let timestamp: number | undefined;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t" && value !== undefined) timestamp = Number(value);
    if (key === "v1" && value !== undefined) signatures.push(value);
  }

  if (timestamp === undefined || !Number.isInteger(timestamp)) return undefined;
  if (signatures.length === 0) return undefined;
  return { timestamp, signatures };
}

function hmac(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1_000);
}

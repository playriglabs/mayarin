/**
 * TransFi webhook signature check.
 *
 * `X-Transfi-Hmac-Hash` is the hex HMAC-SHA256 of the raw request body, keyed by
 * the dashboard's webhook secret. The raw body is the input — a parsed and
 * re-serialised one can differ in bytes and fail a genuine delivery.
 *
 * A webhook is a signal, not truth: even a valid one only says to look at the
 * order again.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhookSignature(
  rawBody: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (signature === undefined) return false;

  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

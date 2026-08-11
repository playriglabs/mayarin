import { describe, expect, test } from "bun:test";
import { constructWebhook, MayarinWebhookError, verifyWebhook } from "../src/webhooks.ts";

const NOW = new Date("2026-08-11T10:00:00.000Z");
const TIMESTAMP = Math.floor(NOW.getTime() / 1_000);
const SECRET = "whsec_test";
const PAYLOAD = JSON.stringify({ type: "payment.succeeded", paymentId: "pay_1" });

async function signature(payload = PAYLOAD, timestamp = TIMESTAMP): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)),
  );
  const digest = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${digest}`;
}

describe("webhook verifier", () => {
  test("verifies and parses an authentic event", async () => {
    const event = await constructWebhook<{ readonly paymentId: string }>({
      payload: PAYLOAD,
      signature: await signature(),
      secret: SECRET,
      now: NOW,
    });
    expect(event.paymentId).toBe("pay_1");
  });

  test("rejects a tampered payload", async () => {
    const error = await verifyWebhook({
      payload: `${PAYLOAD} `,
      signature: await signature(),
      secret: SECRET,
      now: NOW,
    }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(MayarinWebhookError);
    expect((error as MayarinWebhookError).code).toBe("INVALID_SIGNATURE");
  });

  test("rejects a replay outside the tolerance window", async () => {
    const oldTimestamp = TIMESTAMP - 301;
    const error = await verifyWebhook({
      payload: PAYLOAD,
      signature: await signature(PAYLOAD, oldTimestamp),
      secret: SECRET,
      now: NOW,
    }).catch((value: unknown) => value);
    expect((error as MayarinWebhookError).code).toBe("STALE_TIMESTAMP");
  });

  test("rejects a signature made with the wrong secret", async () => {
    const error = await verifyWebhook({
      payload: PAYLOAD,
      signature: await signature(),
      secret: "whsec_wrong",
      now: NOW,
    }).catch((value: unknown) => value);
    expect((error as MayarinWebhookError).code).toBe("INVALID_SIGNATURE");
  });
});

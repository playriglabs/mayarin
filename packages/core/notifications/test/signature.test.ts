import { describe, expect, test } from "bun:test";
import { signWebhook, verifyWebhook } from "../src/index.ts";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const BODY = '{"id":"evt_1","type":"payment.state_changed"}';

describe("webhook signature", () => {
  test("a signed payload verifies with the same secret", () => {
    const header = signWebhook({ secrets: ["whsec_a"], timestamp: NOW, body: BODY });

    expect(verifyWebhook({ header, body: BODY, secrets: ["whsec_a"], now: NOW })).toBe(true);
  });

  test("a wrong secret does not verify", () => {
    const header = signWebhook({ secrets: ["whsec_a"], timestamp: NOW, body: BODY });

    expect(verifyWebhook({ header, body: BODY, secrets: ["whsec_b"], now: NOW })).toBe(false);
  });

  test("a tampered body does not verify", () => {
    const header = signWebhook({ secrets: ["whsec_a"], timestamp: NOW, body: BODY });

    expect(verifyWebhook({ header, body: `${BODY} `, secrets: ["whsec_a"], now: NOW })).toBe(false);
  });

  test("during a rotation, a receiver holding only the old secret still verifies", () => {
    // The dispatcher signs with both the current and the previous secret.
    const header = signWebhook({ secrets: ["whsec_new", "whsec_old"], timestamp: NOW, body: BODY });

    expect(verifyWebhook({ header, body: BODY, secrets: ["whsec_old"], now: NOW })).toBe(true);
    expect(verifyWebhook({ header, body: BODY, secrets: ["whsec_new"], now: NOW })).toBe(true);
  });

  test("a timestamp outside the tolerance does not verify", () => {
    const header = signWebhook({ secrets: ["whsec_a"], timestamp: NOW, body: BODY });
    const later = new Date(NOW.getTime() + 301_000);

    expect(verifyWebhook({ header, body: BODY, secrets: ["whsec_a"], now: later })).toBe(false);
    expect(
      verifyWebhook({
        header,
        body: BODY,
        secrets: ["whsec_a"],
        now: later,
        toleranceSeconds: 400,
      }),
    ).toBe(true);
  });

  test("a malformed header does not verify", () => {
    for (const header of ["", "t=abc,v1=00", "v1=00", "t=1767225600", "nonsense"]) {
      expect(verifyWebhook({ header, body: BODY, secrets: ["whsec_a"], now: NOW })).toBe(false);
    }
  });
});

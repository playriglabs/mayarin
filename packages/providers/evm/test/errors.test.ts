/**
 * Reducing a viem error to one line (#69).
 *
 * The message this produces is stored as a payment's failure reason and shown
 * to a merchant, so what matters is that the sentence survives and the
 * transcript does not.
 */

import { describe, expect, test } from "bun:test";
import { shortReason } from "../src/errors.ts";

describe("shortReason", () => {
  test("prefers viem's own short message over the full dump", () => {
    const error = Object.assign(
      new Error(
        "Nonce provided for the transaction (138) is lower than the current nonce.\n\nRequest Arguments:\n  from: 0x616e\n  data: 0x0b6cd4d9…\n\nDetails: already known\nVersion: viem@2.55.10",
      ),
      { shortMessage: "Nonce provided for the transaction (138) is lower than the current nonce." },
    );

    expect(shortReason(error)).toBe(
      "Nonce provided for the transaction (138) is lower than the current nonce.",
    );
  });

  test("cuts an unstructured message at the first argument section", () => {
    const error = new Error(
      "HTTP request failed.\n\nStatus: 429\nURL: https://example.invalid\nRequest body: {}",
    );

    expect(shortReason(error)).toBe("HTTP request failed.");
  });

  test("caps a long sentence rather than storing calldata", () => {
    const error = new Error(`${"x".repeat(500)}`);

    expect(shortReason(error).length).toBeLessThanOrEqual(200);
    expect(shortReason(error).endsWith("…")).toBe(true);
  });

  test("falls back to the provider's detail when there is no short message", () => {
    const error = Object.assign(new Error("something\n\nRequest Arguments: …"), {
      details: "already known",
    });

    expect(shortReason(error)).toBe("already known");
  });
});

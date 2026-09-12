import { describe, expect, test } from "bun:test";
import type { X402GateDecision } from "@mayarin/sdk";
import { renderPaymentRequiredPage } from "./paywall.ts";

type PaymentRequiredDecision = Extract<X402GateDecision, { readonly kind: "payment-required" }>;

const decision: PaymentRequiredDecision = {
  kind: "payment-required",
  paymentRequiredHeader: "encoded",
  paymentRequired: {
    x402Version: 2,
    resource: {
      url: "http://localhost:8787/premium",
      description: "Premium <signals> & analysis",
    },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:84532",
        amount: "1000000",
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        payTo: "0x596a7fb9857ca6c008dae1ba8e0e44c0eb38c1f5",
        maxTimeoutSeconds: 60,
        extra: { name: "USDC", version: "2", assetTransferMethod: "eip3009" },
      },
    ],
  },
};

/** The same decision with `accepts` replaced, in the order Mayarin offered them. */
function railed(
  rails: readonly { network: string; amount: string; token: string }[],
): PaymentRequiredDecision {
  return {
    ...decision,
    paymentRequired: {
      ...decision.paymentRequired,
      accepts: rails.map((rail) => ({
        scheme: "exact",
        network: rail.network,
        amount: rail.amount,
        asset: "0x3600000000000000000000000000000000000000",
        payTo: "0x596a7fb9857ca6c008dae1ba8e0e44c0eb38c1f5",
        maxTimeoutSeconds: 60,
        extra: { name: rail.token, version: "2", assetTransferMethod: "eip3009" },
      })),
    },
  };
}

describe("x402 merchant paywall", () => {
  test("renders a responsive paid-content view from the live requirements", () => {
    const page = renderPaymentRequiredPage(decision);

    expect(page).toContain("Unlock this content");
    expect(page).toContain("1.00 USDC");
    expect(page).toContain("Base Sepolia");
    expect(page).toContain('name="viewport"');
    expect(page).toContain("@tailwindcss/browser@4");
    expect(page).toContain("@fontsource/inter@5");
    expect(page).toContain("motion-reduce:transition-none");
  });

  test("prices the headline from the first offered rail, never from the page", () => {
    const page = renderPaymentRequiredPage(
      railed([
        { network: "eip155:5042002", amount: "2046810", token: "EURC" },
        { network: "eip155:5042002", amount: "1000000", token: "USDC" },
      ]),
    );

    // The rail Mayarin offered first is the headline, at the token's own precision.
    expect(page).toContain("2.04681 EURC");
    expect(page).toContain("1.00 USDC");
    expect(page).not.toContain("$1.00");
  });

  test("names a chain the way every other Mayarin surface names it", () => {
    const page = renderPaymentRequiredPage(
      railed([{ network: "eip155:5042002", amount: "1000000", token: "USDC" }]),
    );

    expect(page).toContain("Arc Testnet");
    expect(page).not.toContain("eip155:5042002");
  });

  test("falls back to the CAIP-2 id for a chain Mayarin does not know", () => {
    const page = renderPaymentRequiredPage(
      railed([{ network: "eip155:999999", amount: "1000000", token: "USDC" }]),
    );

    expect(page).toContain("eip155:999999");
  });

  test("escapes resource copy before placing it in HTML", () => {
    const page = renderPaymentRequiredPage(decision);

    expect(page).toContain("Premium &lt;signals&gt; &amp; analysis");
    expect(page).not.toContain("Premium <signals> & analysis");
  });
});

import { describe, expect, test } from "bun:test";
import { BasisPointsFeePolicy } from "@mayarin/clearing";
import { FixedPriceOracle } from "@mayarin/clearing/testing";
import { priceSourceOf } from "@mayarin/execution";
import { FixedSwapVenue } from "@mayarin/execution/testing";
import { QuoteEngine } from "@mayarin/quote";
import { FakeOrderSigner } from "@mayarin/quote/testing";
import { ConfigurationError, FixedClock, money } from "@mayarin/shared";
import { InMemoryStablecoinRegistry } from "@mayarin/stablecoin";
import { ApiContractPlanner } from "../src/contract-layer.ts";
import type { QuoteLayer } from "../src/quote-layer.ts";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const ROUTER = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a";
const MERCHANT_SAFE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAYER = "0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0";
const IDRX_TOKEN = "0x00000000000000000000000000000000000001d1";

/** 60,000,000.00 IDRX per whole ETH. */
const ETH_IDRX_RATE = 6_000_000_000n;

// `null` means the merchant has no settlement address; `undefined` would be
// swallowed by the default parameter and silently pass the address through.
function createPlanner(settlementAddress: string | null = MERCHANT_SAFE) {
  const clock = new FixedClock(NOW);
  const venue = new FixedSwapVenue("0x", [
    { from: "ETH", to: "IDRX", scaledRate: ETH_IDRX_RATE, source: "0x" },
  ]);
  const oracle = new FixedPriceOracle([
    {
      from: "ETH",
      to: "IDRX",
      scaledRate: ETH_IDRX_RATE,
      source: "pyth",
      observedAt: NOW,
    },
  ]);
  const signer = new FakeOrderSigner();
  const engine = new QuoteEngine({
    venue: priceSourceOf(venue),
    oracle,
    policy: { maxDeviationBps: 100, maxAgeMs: 60_000 },
    fiat: {
      pegged: ["IDR/IDRX"],
      maxAgeMs: 300_000,
      closedMaxAgeMs: 300_000,
      closedSpreadBps: 0,
    },
    clock,
  });
  const quote: QuoteLayer = {
    engine,
    venues: [venue],
    oracle,
    signer,
    slippageBps: 50,
    ttlSeconds: 120,
  };
  const planner = new ApiContractPlanner({
    contract: { paymentRouters: { base: ROUTER } },
    quote: async () => quote,
    fees: new BasisPointsFeePolicy(50),
    stablecoins: new InMemoryStablecoinRegistry([
      { asset: "IDRX", onChain: [{ chain: "base", address: IDRX_TOKEN }] },
    ]),
    merchantPolicies: {
      policyFor: async () => ({
        settlementAsset: "IDRX" as const,
        acceptedAssets: [],
        ...(settlementAddress === null ? {} : { settlementAddress }),
      }),
    },
    clock,
  });
  return { planner, venue, signer, clock };
}

function lockRequest(payerAsset: "ETH" | "IDRX") {
  return {
    clearingTransactionId: "clr_test_1",
    paymentIntentId: "pi_test_1",
    merchantId: "ID1020017611473",
    sourceAmount: money(5_000_000n, "IDR"),
    settlementAsset: "IDRX",
    payerAsset,
    chain: "base",
    payerAddress: PAYER,
  } as const;
}

describe("ApiContractPlanner", () => {
  test("locks a cross-asset payment: signed order agrees with the lock", async () => {
    const { planner, signer } = createPlanner();

    const lock = await planner.lock(lockRequest("ETH"));

    expect(lock.settlementAmount).toEqual(money(5_000_000n, "IDRX"));
    expect(lock.fee).toEqual(money(25_000n, "IDRX"));
    expect(lock.order.minOut).toBe(5_000_000n);
    expect(lock.order.fee).toBe(25_000n);
    expect(lock.order.settlementToken.toLowerCase()).toBe(IDRX_TOKEN);
    expect(lock.order.merchantSafe).toBe(MERCHANT_SAFE);
    expect(lock.order.refundTo).toBe(PAYER);
    expect(lock.order.signer).toBe(await signer.address());
    expect(lock.expiresAt).toEqual(new Date(NOW.getTime() + 120_000));
    expect(lock.order.deadline).toBe(BigInt(Math.floor(lock.expiresAt.getTime() / 1_000)));

    // The payer estimate is grossed up: never below the raw conversion.
    const raw = (5_000_000n * 10n ** 18n) / ETH_IDRX_RATE;
    expect(lock.payerEstimate.asset).toBe("ETH");
    expect(lock.payerEstimate.amount >= raw).toBe(true);

    // The typed data went to the signer with the deployment's domain.
    expect(signer.calls).toHaveLength(1);
    expect(signer.calls[0]?.domain.chainId).toBe(8_453n);
    expect(signer.calls[0]?.domain.verifyingContract).toBe(ROUTER);
    expect(signer.calls[0]?.message.intentId).toBe(lock.order.intentId as `0x${string}`);
  });

  test("the intent id derives from the clearing transaction: a re-lock signs the same id", async () => {
    const { planner } = createPlanner();

    const first = await planner.lock(lockRequest("ETH"));
    const second = await planner.lock(lockRequest("ETH"));

    expect(second.order.intentId).toBe(first.order.intentId);
  });

  test("a same-asset payment skips the swap leg entirely", async () => {
    const { planner, venue } = createPlanner();

    const lock = await planner.lock(lockRequest("IDRX"));

    expect(venue.calls).toHaveLength(0);
    expect(lock.payerEstimate).toEqual(money(5_000_000n, "IDRX"));
    expect(lock.rate.source).toBe("peg");
    expect(lock.order.minOut).toBe(5_000_000n);
  });

  test("a chain without a deployed router is refused", async () => {
    const { planner } = createPlanner();

    expect(planner.lock({ ...lockRequest("ETH"), chain: "base-sepolia" })).rejects.toThrow(
      /No PaymentRouter deployed/,
    );
  });
});

describe("merchant settlement address", () => {
  test("refuses to sign an order for a merchant with no settlement address", async () => {
    // No deployment-wide fallback exists on purpose: one would sign every
    // merchant's payments to the same wallet, and `merchantSafe` is inside the
    // EIP-712 digest the contract verifies, so the mistake is unrecoverable.
    const { planner } = createPlanner(null);

    await expect(planner.lock(lockRequest("ETH"))).rejects.toBeInstanceOf(ConfigurationError);
  });
});

/**
 * Cross-asset x402 (#211): the agent signs in what it holds, the merchant is
 * paid in what they chose.
 *
 * The direction is the whole point. A merchant's invoice is the fixed number
 * and the payer's is derived, so the price has to be asked backwards — what
 * does delivering *exactly* this settlement amount cost? Asking forwards prices
 * whatever depth a one-unit probe happened to touch, which is the mistake that
 * locked a `minOut` a thin pool could not fill.
 */

import { describe, expect, test } from "bun:test";
import type { ChainId } from "@mayarin/chain";
import { type PriceQuote, type PriceSource, StaticRateProvider } from "@mayarin/clearing";
import { FixedPriceOracle } from "@mayarin/clearing/testing";
import { QuoteEngine } from "@mayarin/quote";
import { type AssetCode, ConfigurationError, type Money, money, RATE_SCALE } from "@mayarin/shared";
import { AssetCapabilities, facilitatorRegistry } from "@mayarin/x402";
import {
  EURC_BASE_SEPOLIA,
  exampleResource,
  FakeCrossAssetSettler,
  FakeFacilitator,
  FakeSettlementConfirmer,
  InMemoryResourceRepository,
  USDC_BASE_SEPOLIA,
} from "@mayarin/x402/testing";
import { createHarness } from "../../../packages/core/clearing/test/harness.ts";
import { X402Service } from "../src/services/x402.ts";

const OPERATOR = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";

const MERCHANT_SAFE = "0xe5DD11a0579C0ab6a60B8263277c174cC8Eb675E";
const SLIPPAGE_BPS = 50;

/**
 * A venue with depth, which is the only kind where the two directions differ.
 *
 * `price` answers the one-unit probe optimistically and `priceExactOutput`
 * answers at the size the swap will actually execute at. A test whose source
 * gives the same number both ways cannot tell which direction was asked.
 */
class TwoDirectionSource implements PriceSource {
  async price(from: AssetCode, to: AssetCode): Promise<PriceQuote> {
    return { from, to, scaledRate: 1_200_000n * RATE_SCALE, source: "probe" };
  }

  async priceExactOutput(from: AssetCode, to: AssetCode): Promise<PriceQuote> {
    return { from, to, scaledRate: 1_000_000n * RATE_SCALE, source: "exact-output" };
  }
}

/** A venue that has depth but cannot be asked backwards — an aggregator. */
class ForwardOnlySource implements PriceSource {
  async price(from: AssetCode, to: AssetCode): Promise<PriceQuote> {
    return { from, to, scaledRate: 1_200_000n * RATE_SCALE, source: "probe" };
  }

  async priceExactOutput(from: AssetCode, to: AssetCode): Promise<PriceQuote> {
    throw new ConfigurationError(`This venue cannot price ${from} -> ${to} by exact output`, {
      from,
      to,
    });
  }
}

function service(options: {
  readonly settler?: FakeCrossAssetSettler;
  readonly venue?: PriceSource;
  readonly accepts?: readonly (typeof USDC_BASE_SEPOLIA)[];
  readonly withQuoteLayer?: boolean;
  readonly price?: Money;
}) {
  const settler = options.settler ?? new FakeCrossAssetSettler();
  const clearing = createHarness({
    autoConfirmAssetReceipt: false,
    rates: { "USD/USDC": 1_000_000n },
  });
  const engine = new QuoteEngine({
    venue: options.venue ?? new TwoDirectionSource(),
    oracle: new FixedPriceOracle([
      {
        from: "EURC",
        to: "USDC",
        scaledRate: 1_000_000n * RATE_SCALE,
        source: "test-oracle",
        observedAt: clearing.clock.now(),
      },
    ]),
    clock: clearing.clock,
    // Wide enough that the two directions above both pass; this test is about
    // which one was asked, not about the guard.
    policy: { maxDeviationBps: 5_000, maxAgeMs: 60_000 },
    fiat: { pegged: ["USD/USDC"], maxAgeMs: 60_000, closedMaxAgeMs: 60_000, closedSpreadBps: 0 },
  });

  const resources = new InMemoryResourceRepository();
  const resource = exampleResource({
    id: "fx-quote",
    price: options.price ?? money(2n, "USD"),
    accepts: options.accepts ?? [{ ...EURC_BASE_SEPOLIA, payTo: OPERATOR }],
  });

  const x402 = new X402Service({
    resources,
    facilitators: facilitatorRegistry([
      new FakeFacilitator().willSettleWith({
        success: true,
        transaction: `0x${"ab".repeat(32)}`,
        network: "eip155:84532",
      }),
    ]),
    capabilities: new AssetCapabilities({
      pairs: [],
      probes: [
        {
          chain: "base-sepolia",
          async probe(contract) {
            return {
              chain: "base-sepolia",
              contract,
              transferMethod: "eip3009",
              domain: { name: "USDC", version: "2" },
              supportsPermit: true,
            };
          },
        },
      ],
    }),
    confirmers: new Map([["eip155:84532", new FakeSettlementConfirmer()]]),
    rates: new StaticRateProvider({ "USD/USDC": 1_000_000n }),
    intents: clearing.intents,
    engine: clearing.engine,
    clock: clearing.clock,
    quoteTtlSeconds: 60,
    merchantSnapshot: async (id) => ({
      id,
      name: "Test merchant",
      city: "Jakarta",
      countryCode: "ID",
    }),
    settlementAssetOf: async () => "USDC",
    ...(options.withQuoteLayer === false
      ? {}
      : { quote: async () => ({ engine, slippageBps: SLIPPAGE_BPS }) }),
    operatorAddress: OPERATOR,
    crossAssetSettler: settler,
  });

  return { x402, resources, resource };
}

describe("a cross-asset 402", () => {
  test("prices the payer's asset backwards from the merchant's amount", async () => {
    const { x402, resources, resource } = service({});
    await resources.save(resource);

    const required = await x402.paymentRequired(resource);
    const offered = required.accepts[0];

    // 0.02 USD pegs to 20000 minor USDC. At the exact-output rate of 1 USDC per
    // EURC that is 20000 EURC minor units, grossed up by 50 bps of slippage:
    // ceil(20000 * 10_000 / 9_950) = 20101.
    //
    // The one-unit probe would have said 16751 — a payment the pool could not
    // fill, signed for an amount that cannot be topped up.
    expect(offered?.asset).toBe(EURC_BASE_SEPOLIA.contract);
    expect(offered?.amount).toBe("20101");
  });

  test("falls back to the probe when the venue cannot price backwards", async () => {
    const { x402, resources, resource } = service({ venue: new ForwardOnlySource() });
    await resources.save(resource);

    const required = await x402.paymentRequired(resource);

    // Worse, and honest about it: an aggregator that cannot be asked backwards
    // is still a rail, and refusing it would close a resource that has one.
    expect(required.accepts[0]?.amount).toBe("16751");
  });

  test("drops the rail when the deployment has no quote layer", async () => {
    const { x402, resources, resource } = service({ withQuoteLayer: false });
    await resources.save(resource);

    // The only rail is cross-asset and nothing can swap it, so there is no way
    // to be paid at all — which is a different answer from a silent empty body.
    await expect(x402.paymentRequired(resource)).rejects.toThrow(/no way to be paid/);
  });

  test("keeps a same-asset rail when the cross-asset one cannot be priced", async () => {
    const { x402, resources, resource } = service({
      withQuoteLayer: false,
      accepts: [{ ...EURC_BASE_SEPOLIA, payTo: OPERATOR }, USDC_BASE_SEPOLIA],
    });
    await resources.save(resource);

    const required = await x402.paymentRequired(resource);

    expect(required.accepts.map((accept) => accept.asset)).toEqual([USDC_BASE_SEPOLIA.contract]);
  });
});

describe("registering a cross-asset rail", () => {
  const input = (payTo: string) => ({
    id: "fx-quote",
    merchantId: "mer_example",
    url: "https://api.example.com/x402/fx/quote",
    price: money(2n, "USD"),
    accepts: [
      {
        chain: "base-sepolia" as ChainId,
        asset: "EURC" as AssetCode,
        contract: EURC_BASE_SEPOLIA.contract,
        payTo,
      },
    ],
    maxTimeoutSeconds: 60,
  });

  test("refuses a rail that pays anyone but the operator", async () => {
    const { x402 } = service({});

    // Paying the merchant directly would settle a USDC invoice in EURC, which
    // is not the asset they agreed to hold.
    await expect(x402.register(input(MERCHANT_SAFE))).rejects.toThrow(/must pay the operator/);
  });

  test("refuses a rail this deployment cannot swap", async () => {
    const { x402 } = service({ withQuoteLayer: false });

    await expect(x402.register(input(OPERATOR))).rejects.toThrow(
      /needs a quote layer, an operator and a settler/,
    );
  });

  test("accepts a rail that pays the operator", async () => {
    const { x402 } = service({});

    const resource = await x402.register(input(OPERATOR));

    expect(resource.accepts[0]?.payTo).toBe(OPERATOR);
    expect(resource.accepts[0]?.transferMethod).toBe("eip3009");
  });
});

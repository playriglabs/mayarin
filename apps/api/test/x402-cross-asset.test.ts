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
import {
  AssetCapabilities,
  facilitatorRegistry,
  type PaymentPayload,
  selectRequirements,
} from "@mayarin/x402";
import {
  EURC_BASE_SEPOLIA,
  EXAMPLE_EIP3009_PAYLOAD,
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
const PAYER = "0x1111111111111111111111111111111111111111";
const AUTHORIZATION_TX = `0x${"ab".repeat(32)}`;
const SWAP_TX = `0x${"cd".repeat(32)}`;
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
  const confirmer = new FakeSettlementConfirmer();
  const facilitator = new FakeFacilitator().willSettleWith({
    success: true,
    transaction: AUTHORIZATION_TX,
    network: "eip155:84532",
  });
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
    facilitators: facilitatorRegistry([facilitator]),
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
    confirmers: new Map([["eip155:84532", confirmer]]),
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
    settlementAddressOf: async () => MERCHANT_SAFE,
  });

  return { x402, resources, resource, settler, confirmer, clearing };
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

describe("settling a cross-asset payment", () => {
  /** Signs for whatever the `402` asked, which is what an honest agent does. */
  async function paid(built: Awaited<ReturnType<typeof settleHarness>>) {
    const required = await built.x402.paymentRequired(built.resource);
    const accepted = required.accepts[0];
    if (accepted === undefined) throw new Error("No cross-asset rail was offered");

    const payment: PaymentPayload = {
      x402Version: 2,
      accepted,
      payload: {
        ...EXAMPLE_EIP3009_PAYLOAD,
        authorization: {
          ...EXAMPLE_EIP3009_PAYLOAD.authorization,
          from: PAYER,
          to: OPERATOR,
          value: accepted.amount,
          validAfter: "0",
          validBefore: String(Math.floor(built.clearing.clock.now().getTime() / 1000) + 55),
        },
      },
    };

    // The chain's side of the authorization: the payer's EURC reached the
    // operator, which is where a cross-asset rail has to send it.
    built.confirmer.recordMatching(AUTHORIZATION_TX, selectRequirements(required, payment), PAYER);
    return { payment, accepted };
  }

  async function settleHarness(settler?: FakeCrossAssetSettler, price?: Money) {
    const built = service({
      ...(settler === undefined ? {} : { settler }),
      ...(price === undefined ? {} : { price }),
    });
    await built.resources.save(built.resource);
    return built;
  }

  /** The receipt event, which is where the change's disposition is recorded. */
  async function receiptPayload(built: Awaited<ReturnType<typeof settleHarness>>, id: string) {
    const events = await built.clearing.repositories.clearing.listEvents(id);
    const receipt = events.find((event) => event.toState === "ASSET_RECEIVED");
    if (receipt === undefined) throw new Error("No ASSET_RECEIVED event was appended");
    return receipt.payload as Record<string, unknown>;
  }

  test("pays the merchant the invoice and books the payer's change", async () => {
    // A 2.00 USD invoice, so the change clears EURC's dust threshold of one
    // cent: authorised 2010051 EURC, the swap consumed 1990000, and the 20051
    // left over is slippage the payer carried and the pool did not need.
    const settler = new FakeCrossAssetSettler()
      .willPlan(money(2_000_000n, "EURC"))
      .willSpend(money(1_990_000n, "EURC"))
      .willUseTransaction(SWAP_TX);
    const built = await settleHarness(settler, money(200n, "USD"));
    const { payment } = await paid(built);

    const { intent } = await built.x402.settle(built.resource, payment);

    expect(intent.status).toBe("COMPLETED");
    // Delivered to the merchant's own address, not to the rail's `payTo` —
    // that one is the operator's, because the EURC had to land somewhere
    // swappable.
    expect(settler.sent[0]?.recipient).toBe(MERCHANT_SAFE);
    expect(settler.sent[0]?.exactOut).toEqual(money(2_000_000n, "USDC"));
    // Not absorbed, not booked as an FX gain, and not taken as revenue either:
    // it is the payer's, and above dust it stays owed to them.
    expect((await built.clearing.ledger.balance("PAYER_SURPLUS", "EURC")).balance).toEqual(
      money(20_051n, "EURC"),
    );
    expect((await built.clearing.ledger.balance("PAYER_ASSET_HELD", "EURC")).balance).toEqual(
      money(20_051n, "EURC"),
    );
    expect((await built.clearing.ledger.balance("FEE_REVENUE", "EURC")).balance).toEqual(
      money(0n, "EURC"),
    );
  });

  test("records who refundable change is owed to", async () => {
    // A liability nobody can be paid from is not a refund. The address comes
    // off the chain — `ConfirmedSettlement.payer` — rather than out of the
    // payload, for the same reason every other field on that receipt does.
    const settler = new FakeCrossAssetSettler()
      .willPlan(money(2_000_000n, "EURC"))
      .willSpend(money(1_990_000n, "EURC"))
      .willUseTransaction(SWAP_TX);
    const built = await settleHarness(settler, money(200n, "USD"));
    const { payment } = await paid(built);

    const { intent } = await built.x402.settle(built.resource, payment);
    const transaction = await built.clearing.repositories.clearing.findByPaymentIntentId(intent.id);
    if (transaction === null) throw new Error("No clearing transaction for the intent");

    expect(await receiptPayload(built, transaction.id)).toMatchObject({
      payerSurplus: { amount: "20051", asset: "EURC" },
      payerSurplusDisposition: "refundable",
      payerRefundAddress: PAYER,
    });
  });

  test("takes change too small to return, and says so rather than absorbing it", async () => {
    // 121 minor units is 0.000121 EURC. Returning it is an ERC-20 transfer the
    // operator pays gas for and a liability row somebody reconciles, both worth
    // more than the change — so it is taken as revenue, in an account and an
    // event, which is the part that distinguishes this from absorbing it.
    const settler = new FakeCrossAssetSettler()
      .willPlan(money(20_000n, "EURC"))
      .willSpend(money(19_980n, "EURC"))
      .willUseTransaction(SWAP_TX);
    const built = await settleHarness(settler);
    const { payment } = await paid(built);

    const { intent } = await built.x402.settle(built.resource, payment);
    const transaction = await built.clearing.repositories.clearing.findByPaymentIntentId(intent.id);
    if (transaction === null) throw new Error("No clearing transaction for the intent");

    expect((await built.clearing.ledger.balance("FEE_REVENUE", "EURC")).balance).toEqual(
      money(121n, "EURC"),
    );
    // Nothing is owed back, so nothing sits in the liability account waiting to
    // be paid out by a transaction nobody would ever send.
    expect((await built.clearing.ledger.balance("PAYER_SURPLUS", "EURC")).balance).toEqual(
      money(0n, "EURC"),
    );

    const payload = await receiptPayload(built, transaction.id);
    expect(payload).toMatchObject({
      payerSurplus: { amount: "121", asset: "EURC" },
      payerSurplusDisposition: "dust",
    });
    // No address, because there is no refund to send to one.
    expect(payload.payerRefundAddress).toBeUndefined();
  });

  test("plans the swap before the payer's money moves", async () => {
    // The price moved between the 402 and the signature: the route now needs
    // more than the payer authorised.
    const settler = new FakeCrossAssetSettler().willPlan(money(30_000n, "EURC"));
    const built = await settleHarness(settler);
    const { payment } = await paid(built);

    await expect(built.x402.settle(built.resource, payment)).rejects.toThrow(
      /spend more than the payer authorised/,
    );

    // The refusal is worth nothing if the authorization went out anyway: the
    // payer's EURC would sit at the operator with the merchant unpaid and the
    // nonce spent, so no retry could ever pay them.
    expect(settler.planned).toHaveLength(1);
    expect(settler.sent).toHaveLength(0);
  });

  test("records the swap hash before it is confirmed", async () => {
    const settler = new FakeCrossAssetSettler()
      .willUseTransaction(SWAP_TX)
      .willFailToConfirm(new Error("RPC is down"));
    const built = await settleHarness(settler);
    const { payment } = await paid(built);

    await expect(built.x402.settle(built.resource, payment)).rejects.toThrow("RPC is down");

    // A swap has no nonce to stop a second one, so the hash has to survive a
    // confirmation that throws — otherwise a resume sends it again, spending
    // the operator's own balance and paying the merchant twice.
    const [stuck] = await built.clearing.repositories.clearing.listResumable(1);
    expect(stuck?.providerReference).toBe(SWAP_TX);
    expect(stuck?.state).toBe("PAYMENT_PENDING");

    // And the log keeps both movements: the authorization it replaced, and the
    // swap it moved on to.
    const events = await built.clearing.repositories.clearing.listEvents(stuck?.id ?? "");
    expect(events.filter((event) => event.type === "settlement.broadcast")).toHaveLength(1);
    expect(events.filter((event) => event.type === "settlement.swap")).toHaveLength(1);
  });
});

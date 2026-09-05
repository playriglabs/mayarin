import { describe, expect, test } from "bun:test";
import { LiquidityRouter, TablePriceSource } from "@mayarin/clearing";
import { FixedPriceOracle } from "@mayarin/clearing/testing";
import { QuoteEngine } from "@mayarin/quote";
import { FakeOrderSigner } from "@mayarin/quote/testing";
import { money, ProviderError } from "@mayarin/shared";
import {
  AssetCapabilities,
  decodeSettleResponse,
  facilitatorRegistry,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  type PaymentPayload,
} from "@mayarin/x402";
import {
  EXAMPLE_EIP3009_PAYLOAD,
  exampleResource,
  FakeFacilitator,
  FakeSettlementConfirmer,
  InMemoryResourceRepository,
} from "@mayarin/x402/testing";
import { Hono } from "hono";
import { createHarness } from "../../../packages/core/clearing/test/harness.ts";
import type { Container } from "../src/container.ts";
import { errorHandler } from "../src/errors.ts";
import { RuntimePriceSource } from "../src/market.ts";
import { x402Routes } from "../src/routes/x402.ts";
import { X402Service } from "../src/services/x402.ts";

const TX_HASH = `0x${"ab".repeat(32)}`;
const URL = "/x402/fx/quote?from=USD&to=USDC";

async function harness() {
  const clearing = createHarness({
    autoConfirmAssetReceipt: false,
    rates: { "USD/USDC": 1_000_000n },
  });
  const oracle = new FixedPriceOracle([]);
  const engine = new QuoteEngine({
    venue: new TablePriceSource(),
    oracle,
    clock: clearing.clock,
    policy: { maxDeviationBps: 100, maxAgeMs: 60_000 },
    fiat: { pegged: ["USD/USDC"], maxAgeMs: 60_000, closedMaxAgeMs: 60_000, closedSpreadBps: 0 },
  });
  const rates = new LiquidityRouter({
    source: new RuntimePriceSource({
      quote: async () => ({
        engine,
        oracle,
        venues: [],
        signer: new FakeOrderSigner(),
        slippageBps: 50,
        ttlSeconds: 60,
      }),
      rates: async () => new TablePriceSource(),
    }),
  });
  const resources = new InMemoryResourceRepository();
  const resource = exampleResource({ id: "fx-quote", price: money(2n, "USD") });
  await resources.save(resource);
  const facilitator = new FakeFacilitator().willSettleWith({
    success: true,
    transaction: TX_HASH,
    network: "eip155:84532",
  });
  const confirmer = new FakeSettlementConfirmer();
  const service = new X402Service({
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
    rates,
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
  });
  const offered = await service.paymentRequired(resource);
  const accepted = offered.accepts[0];
  if (accepted === undefined) throw new Error("No test rail");
  const payment: PaymentPayload = {
    x402Version: 2,
    accepted,
    payload: {
      ...EXAMPLE_EIP3009_PAYLOAD,
      authorization: {
        ...EXAMPLE_EIP3009_PAYLOAD.authorization,
        value: accepted.amount,
        validAfter: "0",
        validBefore: String(Math.floor(clearing.clock.now().getTime() / 1000) + 55),
      },
    },
  };
  const container = { x402: service, rates } as unknown as Container;
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/x402", x402Routes(container));
  const headers = {
    [PAYMENT_SIGNATURE_HEADER]: Buffer.from(JSON.stringify(payment)).toString("base64"),
  };
  return {
    app,
    container,
    clearing,
    facilitator,
    confirmer,
    service,
    resource,
    payment,
    accepted,
    headers,
  };
}

describe("paid FX resource with the real quote and clearing engines", () => {
  test("returns the quote and books only the confirmed direct transfer", async () => {
    const h = await harness();
    const unpaid = await h.app.request(URL);
    expect(unpaid.status).toBe(402);
    h.confirmer.recordMatching(TX_HASH, h.accepted, EXAMPLE_EIP3009_PAYLOAD.authorization.from);
    const paid = await h.app.request(URL, { headers: h.headers });
    expect(paid.status).toBe(200);
    expect(await paid.json()).toEqual({
      from: "USD",
      to: "USDC",
      scaledRate: "1000000000000000",
      source: "peg",
    });
    expect(decodeSettleResponse(paid.headers.get(PAYMENT_RESPONSE_HEADER) ?? "").transaction).toBe(
      TX_HASH,
    );
    expect(h.facilitator.settled).toHaveLength(1);
    const intents = await h.clearing.repositories.intents.findByIdempotencyKey(
      `x402:eip155:84532:${h.accepted.asset.toLowerCase()}:${EXAMPLE_EIP3009_PAYLOAD.authorization.nonce}`,
    );
    expect(intents?.status).toBe("COMPLETED");
    const transaction = await h.clearing.engine.findByPaymentIntentId(intents?.id ?? "");
    expect(transaction?.fee).toEqual(money(0n, "USDC"));
    expect(transaction?.netAmount).toEqual(money(20_000n, "USDC"));
    expect(transaction?.onChain?.settledAmount).toEqual(money(20_000n, "USDC"));
    expect(transaction?.providerReference).toBe(TX_HASH);
    expect((await h.clearing.balance("TREASURY")).amount).toBe(0n);
    expect((await h.clearing.balance("FEE_REVENUE")).amount).toBe(0n);
  });

  test("rejects invalid query assets before consuming payment", async () => {
    const h = await harness();
    const response = await h.app.request("/x402/fx/quote?from=invalid&to=USDC", {
      headers: h.headers,
    });
    expect(response.status).toBe(400);
    expect(h.facilitator.settled).toHaveLength(0);
  });

  test("selects the payment chain as well as the token address", async () => {
    const h = await harness();
    const base = h.resource.accepts[0];
    if (base === undefined) throw new Error("Missing Base rail");
    // An address may be identical across networks; array order is not identity.
    const resource = { ...h.resource, accepts: [{ ...base, chain: "arc-testnet" as const }, base] };
    h.confirmer.recordMatching(TX_HASH, h.accepted, EXAMPLE_EIP3009_PAYLOAD.authorization.from);
    const result = await h.service.settle(resource, h.payment);
    expect(result.intent.payment?.chain).toBe("base-sepolia");
    expect(result.intent.status).toBe("COMPLETED");
  });

  test("does not charge when the requested quote cannot be produced", async () => {
    const h = await harness();
    const app = new Hono();
    app.onError(errorHandler);
    app.route(
      "/x402",
      x402Routes({
        ...h.container,
        rates: {
          async quote() {
            throw new ProviderError("Oracle unavailable");
          },
        },
      }),
    );
    const response = await app.request(URL, { headers: h.headers });
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(h.facilitator.settled).toHaveLength(0);
  });

  test("a facilitator success without chain evidence cannot produce a ledger credit", async () => {
    const h = await harness();
    const response = await h.app.request(URL, { headers: h.headers });
    expect(response.status).not.toBe(200);
    expect((await h.clearing.balance("MERCHANT_PAYABLE")).amount).toBe(0n);
    expect((await h.clearing.balance("FEE_REVENUE")).amount).toBe(0n);
    expect(response.headers.get(PAYMENT_RESPONSE_HEADER)).toBeNull();
  });

  // The money moved and the confirmation threw. Before this, the hash existed
  // only in the response nobody kept, and EIP-3009 had already recorded the
  // nonce — so the payer could not retry and nothing could find the transfer.
  test("keeps the broadcast hash when the confirmation fails", async () => {
    const h = await harness();

    await h.app.request(URL, { headers: h.headers });

    const [stranded] = await h.clearing.engine.listResumable();
    expect(stranded?.state).toBe("PAYMENT_PENDING");
    expect(stranded?.providerReference).toBe(TX_HASH);
    expect((await h.clearing.balance("TREASURY")).amount).toBe(0n);
    expect((await h.clearing.balance("FEE_REVENUE")).amount).toBe(0n);
  });

  test("and finishes it from that hash once the chain answers", async () => {
    const h = await harness();
    await h.app.request(URL, { headers: h.headers });
    h.confirmer.recordMatching(TX_HASH, h.accepted, EXAMPLE_EIP3009_PAYLOAD.authorization.from);

    const recovered = await h.service.recoverBroadcasts();

    expect(recovered).toHaveLength(1);
    expect(await h.clearing.engine.listResumable()).toHaveLength(0);
    const intents = await h.clearing.repositories.intents.findByIdempotencyKey(
      `x402:eip155:84532:${h.accepted.asset.toLowerCase()}:${EXAMPLE_EIP3009_PAYLOAD.authorization.nonce}`,
    );
    expect(intents?.status).toBe("COMPLETED");
    const transaction = await h.clearing.engine.findByPaymentIntentId(intents?.id ?? "");
    expect(transaction?.state).toBe("SUCCESS");
    expect(transaction?.providerReference).toBe(TX_HASH);
    expect(transaction?.netAmount).toEqual(money(20_000n, "USDC"));
    expect(transaction?.fee).toEqual(money(0n, "USDC"));
    expect((await h.clearing.balance("TREASURY")).amount).toBe(0n);
    expect((await h.clearing.balance("FEE_REVENUE")).amount).toBe(0n);
  });

  test("recovers nothing while the chain still has no transaction", async () => {
    const h = await harness();
    await h.app.request(URL, { headers: h.headers });

    expect(await h.service.recoverBroadcasts()).toHaveLength(0);
    const [stranded] = await h.clearing.engine.listResumable();
    expect(stranded?.state).toBe("PAYMENT_PENDING");
  });
});

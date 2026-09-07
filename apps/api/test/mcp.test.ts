/**
 * The Subgraph MCP served behind x402 (#231).
 *
 * The interesting property is the line between free and paid. Discovery has to
 * be free — an agent cannot decide a price is worth paying for a tool it has not
 * been allowed to read the description of — and the answer has to be paid, or
 * there is nothing being sold. Everything below is that line, plus the two ways
 * a call must reach the payer's wallet: it must not.
 */

import { describe, expect, test } from "bun:test";
import type { ChainId } from "@mayarin/chain";
import { LiquidityRouter, TablePriceSource } from "@mayarin/clearing";
import { FixedPriceOracle } from "@mayarin/clearing/testing";
import { QuoteEngine } from "@mayarin/quote";
import { FakeOrderSigner } from "@mayarin/quote/testing";
import { money } from "@mayarin/shared";
import {
  AssetCapabilities,
  facilitatorRegistry,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  type PaymentPayload,
  type RailObservation,
  type RailObservationSource,
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
import { mcpRoutes, RAIL_MCP_RESOURCE_ID } from "../src/routes/mcp.ts";
import { X402Service } from "../src/services/x402.ts";

const TX_HASH = `0x${"ab".repeat(32)}`;
const MCP = "/x402/mcp";

/** Records what it was asked, so a test can prove a call never reached it. */
class FakeRailObservations implements RailObservationSource {
  readonly asked: (readonly ChainId[])[] = [];
  constructor(readonly observations: readonly RailObservation[]) {}

  async observe(chains: readonly ChainId[]): Promise<readonly RailObservation[]> {
    this.asked.push(chains);
    return this.observations.filter((observation) => chains.includes(observation.chain));
  }
}

const OBSERVED: readonly RailObservation[] = [
  { chain: "base-sepolia", headroomSeconds: [828, 1797, 28, 900, 40] },
  { chain: "arc-testnet", headroomSeconds: [942, 950, 960, 970, 980] },
];

async function harness(observations: readonly RailObservation[] = OBSERVED) {
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
  const resource = exampleResource({ id: RAIL_MCP_RESOURCE_ID, price: money(2n, "USD") });
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
    settlementAssetOf: async () => "USDC",
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

  const railObservations = new FakeRailObservations(observations);
  const container = { x402: service, rates, railObservations } as unknown as Container;
  const app = new Hono();
  app.onError(errorHandler);
  app.route(MCP, mcpRoutes(container));

  confirmer.recordMatching(TX_HASH, accepted, EXAMPLE_EIP3009_PAYLOAD.authorization.from);

  return {
    app,
    facilitator,
    railObservations,
    headers: {
      [PAYMENT_SIGNATURE_HEADER]: Buffer.from(JSON.stringify(payment)).toString("base64"),
    },
  };
}

function rpc(method: string, params?: unknown, id: unknown = 1) {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params }),
  };
}

describe("discovery is free", () => {
  test("initialize needs no payment", async () => {
    const h = await harness();

    const response = await h.app.request(MCP, rpc("initialize", { protocolVersion: "2025-06-18" }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { serverInfo: { name: string } } };
    expect(body.result.serverInfo.name).toBe("mayarin-rail-intelligence");
    expect(h.facilitator.settled).toHaveLength(0);
  });

  test("tools/list names both tools and their arguments without charging", async () => {
    // An agent has to read what a tool does before it can decide the price is
    // worth paying. A 402 here is a shop with the lights off.
    const h = await harness();

    const response = await h.app.request(MCP, rpc("tools/list"));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((tool) => tool.name)).toEqual(["rail_stats", "choose_rail"]);
    expect(h.facilitator.settled).toHaveLength(0);
  });

  test("a notification gets no answer at all", async () => {
    // No id means nobody is reading a reply.
    const h = await harness();

    const response = await h.app.request(MCP, rpc("notifications/initialized", {}, null));

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  test("an unknown method is a protocol error, not a purchase", async () => {
    const h = await harness();

    const response = await h.app.request(MCP, rpc("resources/list"));

    const body = (await response.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32601);
    expect(h.facilitator.settled).toHaveLength(0);
  });
});

describe("the answer is paid for", () => {
  const call = (name: string, args: Record<string, unknown>) =>
    rpc("tools/call", { name, arguments: args });

  test("a tool call without payment is a 402 carrying the price", async () => {
    const h = await harness();

    const response = await h.app.request(
      MCP,
      call("choose_rail", { chains: ["base-sepolia", "arc-testnet"] }),
    );

    expect(response.status).toBe(402);
    expect(response.headers.get(PAYMENT_REQUIRED_HEADER)).toBeTruthy();
    expect(h.facilitator.settled).toHaveLength(0);
  });

  test("a paid call ranks the rails and says why", async () => {
    const h = await harness();

    const paid = await h.app.request(MCP, {
      ...call("choose_rail", { chains: ["base-sepolia", "arc-testnet"] }),
      headers: {
        "content-type": "application/json",
        ...h.headers,
      },
    });

    expect(paid.status).toBe(200);
    const body = (await paid.json()) as {
      result: { structuredContent: { chain: string; unobserved: boolean }; content: unknown[] };
    };
    // Arc's median is 960 against Base's 828, and the reason travels with it.
    expect(body.result.structuredContent.chain).toBe("arc-testnet");
    expect(body.result.structuredContent.unobserved).toBe(false);
    expect(body.result.content).toHaveLength(1);
    expect(paid.headers.get(PAYMENT_RESPONSE_HEADER)).toBeTruthy();
    expect(h.facilitator.settled).toHaveLength(1);
  });

  test("rail_stats reports the worst settlement, not only the middle", async () => {
    const h = await harness();

    const paid = await h.app.request(MCP, {
      ...call("rail_stats", { chains: ["base-sepolia"] }),
      headers: { "content-type": "application/json", ...h.headers },
    });

    const body = (await paid.json()) as {
      result: { structuredContent: { rails: { minHeadroomSeconds: number }[] } };
    };
    expect(body.result.structuredContent.rails[0]?.minHeadroomSeconds).toBe(28);
  });
});

describe("what is never charged for", () => {
  const call = (name: string, args: Record<string, unknown>) =>
    rpc("tools/call", { name, arguments: args });

  test("arguments the tool refuses cost nothing", async () => {
    // The tool runs before the gate precisely so this is possible: `exact` gives
    // the payer one signature and no way to get it back, and a resource server
    // cannot un-serve a response.
    const h = await harness();

    const response = await h.app.request(MCP, {
      ...call("choose_rail", { chains: ["ethereum-classic"] }),
      headers: { "content-type": "application/json", ...h.headers },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { isError: boolean; content: unknown[] } };
    expect(body.result.isError).toBe(true);
    expect(h.facilitator.settled).toHaveLength(0);
  });

  test("a tool nobody serves is a tool error, not a protocol error", async () => {
    // The call reached the server and the server said no. A model that cannot
    // tell that from "the call never arrived" cannot decide whether to retry.
    const h = await harness();

    const response = await h.app.request(MCP, {
      ...call("drain_treasury", {}),
      headers: { "content-type": "application/json", ...h.headers },
    });

    const body = (await response.json()) as { result: { isError: boolean } };
    expect(body.result.isError).toBe(true);
    expect(h.facilitator.settled).toHaveLength(0);
  });

  test("an answer with no observations behind it is refused rather than sold", async () => {
    // The deletion test, in the form that matters. Take the subgraph away and
    // the agent falls back on its own terms having paid nothing — charging for
    // "no rail has been observed" is charging for our own outage.
    const h = await harness([]);

    const response = await h.app.request(MCP, {
      ...call("choose_rail", { chains: ["base-sepolia", "arc-testnet"] }),
      headers: { "content-type": "application/json", ...h.headers },
    });

    const body = (await response.json()) as { result: { isError: boolean; content: unknown[] } };
    expect(body.result.isError).toBe(true);
    expect(h.facilitator.settled).toHaveLength(0);
    expect(h.railObservations.asked).toHaveLength(1);
  });
});

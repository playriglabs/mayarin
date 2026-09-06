/**
 * The rail measurement, arriving where a payer can act on it.
 *
 * `chooseRail` is tested exhaustively in `@mayarin/x402`. What is tested here
 * is the only thing that makes it matter: that the choice reaches `accepts[0]`,
 * which is the entry a client with no opinion of its own takes.
 */

import { describe, expect, test } from "bun:test";
import { StaticRateProvider } from "@mayarin/clearing";
import { money } from "@mayarin/shared";
import { AssetCapabilities, facilitatorRegistry, type RailObservation } from "@mayarin/x402";
import {
  exampleResource,
  FakeFacilitator,
  InMemoryResourceRepository,
  USDC_ARC_TESTNET,
  USDC_BASE_SEPOLIA,
} from "@mayarin/x402/testing";
import { createHarness } from "../../../packages/core/clearing/test/harness.ts";
import { X402Service } from "../src/services/x402.ts";

/** Both rails priced, so the order that comes out is about the rails alone. */
function service(observations: readonly RailObservation[] | undefined) {
  const clearing = createHarness({
    autoConfirmAssetReceipt: false,
    rates: { "IDR/USDC": 61n },
  });
  const resources = new InMemoryResourceRepository();
  const resource = exampleResource({
    price: money(1_500n, "IDR"),
    accepts: [USDC_BASE_SEPOLIA, USDC_ARC_TESTNET],
  });

  const x402 = new X402Service({
    resources,
    facilitators: facilitatorRegistry([new FakeFacilitator()]),
    capabilities: new AssetCapabilities({
      pairs: [],
      probes: (["base-sepolia", "arc-testnet"] as const).map((chain) => ({
        chain,
        async probe(contract: string) {
          return {
            chain,
            contract,
            transferMethod: "eip3009" as const,
            domain: { name: "USDC", version: "2" },
            supportsPermit: true,
          };
        },
      })),
    }),
    confirmers: new Map(),
    // 1 IDR buys 61 minor-unit USDC-per-whole... the number itself is arbitrary
    // here; both rails price off the same rate, so the order cannot come from it.
    rates: new StaticRateProvider({ "IDR/USDC": 61n }),
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
    ...(observations === undefined ? {} : { rails: { observe: async () => observations } }),
  });

  return { x402, resource };
}

const NETWORKS = { "base-sepolia": "eip155:84532", "arc-testnet": "eip155:5042002" } as const;

describe("a 402 ordered by what the rails have been doing", () => {
  test("lists the rail with the most headroom first, not the one declared first", async () => {
    const { x402, resource } = service([
      { chain: "base-sepolia", headroomSeconds: [30, 28, 40, 35, 33] },
      { chain: "arc-testnet", headroomSeconds: [820, 840, 810, 900, 828] },
    ]);

    const required = await x402.paymentRequired(resource);

    // Declared Base first. Arc settles with ~800s to spare against Base's ~30,
    // and that is the rail an agent taking accepts[0] should land on.
    expect(required.accepts.map((accept) => accept.network)).toEqual([
      NETWORKS["arc-testnet"],
      NETWORKS["base-sepolia"],
    ]);
  });

  test("keeps the declared order when no rail has enough settlements to judge", async () => {
    const { x402, resource } = service([
      { chain: "base-sepolia", headroomSeconds: [30] },
      { chain: "arc-testnet", headroomSeconds: [900, 880] },
    ]);

    const required = await x402.paymentRequired(resource);

    // Arc looks better and is not promoted: two samples is not evidence, and
    // `chooseRail` says so with `unobserved`. Promoting it anyway would dress a
    // fallback up as a decision.
    expect(required.accepts.map((accept) => accept.network)).toEqual([
      NETWORKS["base-sepolia"],
      NETWORKS["arc-testnet"],
    ]);
  });

  test("a deployment that observes nothing behaves exactly as it did before", async () => {
    const { x402, resource } = service(undefined);

    const required = await x402.paymentRequired(resource);

    expect(required.accepts.map((accept) => accept.network)).toEqual([
      NETWORKS["base-sepolia"],
      NETWORKS["arc-testnet"],
    ]);
  });

  test("reports the reasoning, so an agent can see what the order was based on", async () => {
    const { x402, resource } = service([
      { chain: "base-sepolia", headroomSeconds: [30, 28, 40, 35, 33] },
      { chain: "arc-testnet", headroomSeconds: [820, 840, 810, 900, 828] },
    ]);

    const choice = await x402.railChoice(resource);

    expect(choice.chain).toBe("arc-testnet");
    expect(choice.unobserved).toBe(false);
    expect(choice.samples).toBe(5);
    expect(choice.medianHeadroomSeconds).toBe(828);
    expect(choice.reason).toContain("median headroom 828s over 5 settlements");
  });
});

import { describe, expect, test } from "bun:test";
import { StaticRateProvider } from "@mayarin/clearing";
import { money } from "@mayarin/shared";
import { AssetCapabilities, facilitatorRegistry } from "@mayarin/x402";
import {
  exampleResource,
  FakeFacilitator,
  InMemoryResourceRepository,
  USDC_ARC_TESTNET,
  USDC_BASE_SEPOLIA,
} from "@mayarin/x402/testing";
import { createHarness } from "../../../packages/core/clearing/test/harness.ts";
import { X402Service } from "../src/services/x402.ts";

function service() {
  const clearing = createHarness({ autoConfirmAssetReceipt: false, rates: { "IDR/USDC": 61n } });
  const resource = exampleResource({
    price: money(1_500n, "IDR"),
    accepts: [USDC_BASE_SEPOLIA, USDC_ARC_TESTNET],
  });
  const x402 = new X402Service({
    resources: new InMemoryResourceRepository(),
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
  });
  return { resource, x402 };
}

describe("x402 rail order", () => {
  test("keeps the configured order and reports the first rail as default", async () => {
    const { resource, x402 } = service();
    const required = await x402.paymentRequired(resource);

    expect(required.accepts.map((accept) => accept.network)).toEqual([
      "eip155:84532",
      "eip155:5042002",
    ]);
    expect(await x402.railChoice(resource)).toEqual({
      chain: "base-sepolia",
      reason: "base-sepolia: first accepted rail in merchant configuration",
    });
  });
});

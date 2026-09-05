import { describe, expect, test } from "bun:test";
import type { ChainId, ContractCodeSource } from "@mayarin/chain";
import type { AssetCode } from "@mayarin/shared";
import type { MerchantAssetPolicy, MerchantAssetPolicySource } from "../src/merchant-policy.ts";
import {
  type ChainReceipt,
  DerivedRailCatalog,
  type RailPricingSource,
  type SettlementDestinationSource,
} from "../src/rail-catalog.ts";

const BASE: ChainId = "base-sepolia";
const ARC: ChainId = "arc-testnet";

const BASE_RECEIPT: ChainReceipt = {
  chain: BASE,
  nativeAsset: "ETH",
  tokens: { USDC: "0x036cbd53842c5426634e7929541ec2318f3dcf7e" },
};

// No `nativeAsset`: Arc's own currency *is* USDC, one balance seen two ways.
const ARC_RECEIPT: ChainReceipt = {
  chain: ARC,
  tokens: { USDC: "0x3600000000000000000000000000000000000000" },
};

const MERCHANT = "mch_1";
const SAFE_ON_BASE = "0xbasesafe000000000000000000000000000000ba";

function policies(policy: MerchantAssetPolicy | undefined): MerchantAssetPolicySource {
  return { policyFor: async () => policy };
}

function payTo(address: string | undefined): SettlementDestinationSource {
  return { destinationFor: async () => address };
}

/** A destination per chain, so a merchant provisioned on one chain only is expressible. */
function payToPerChain(map: Partial<Record<ChainId, string>>): SettlementDestinationSource {
  return { destinationFor: async (_merchant, chain) => map[chain] };
}

const PRICES_EVERYTHING: RailPricingSource = { canPrice: async () => true };

function pricesAllBut(unpriceable: readonly AssetCode[]): RailPricingSource {
  return { canPrice: async ({ asset }) => !unpriceable.includes(asset) };
}

function codeOn(chains: readonly ChainId[]): ContractCodeSource {
  return { hasCode: async (chain) => chains.includes(chain) };
}

function catalog(overrides: Partial<ConstructorParameters<typeof DerivedRailCatalog>[0]> = {}) {
  return new DerivedRailCatalog({
    receipts: [BASE_RECEIPT, ARC_RECEIPT],
    merchantPolicies: policies(undefined),
    settlement: payTo("0xmerchant00000000000000000000000000000001"),
    pricing: PRICES_EVERYTHING,
    defaultSettlementAsset: "USDC",
    ...overrides,
  });
}

describe("DerivedRailCatalog", () => {
  test("filters assets per chain rather than unioning them", async () => {
    const rails = await catalog().railsFor(MERCHANT);

    expect(
      rails
        .filter((rail) => rail.chain === BASE)
        .map((rail) => rail.asset)
        .sort(),
    ).toEqual(["ETH", "USDC"]);
    expect(rails.filter((rail) => rail.chain === ARC).map((rail) => rail.asset)).toEqual(["USDC"]);
  });

  test("Arc emits exactly one USDC rail even when its native asset is also named", async () => {
    const rails = await catalog({
      receipts: [{ ...ARC_RECEIPT, nativeAsset: "USDC" }],
    }).railsFor(MERCHANT);

    expect(rails).toHaveLength(1);
    expect(rails[0]?.asset).toBe("USDC");
    // The token entry wins: it carries the contract the watcher reads.
    expect(rails[0]?.contract).toBe(ARC_RECEIPT.tokens.USDC);
  });

  test("a chain's own currency carries no contract", async () => {
    const rails = await catalog({ receipts: [BASE_RECEIPT] }).railsFor(MERCHANT);
    const eth = rails.find((rail) => rail.asset === "ETH");

    expect(eth).toBeDefined();
    expect(eth?.contract).toBeUndefined();
  });

  test("a chain with no settlement destination is not offered, with the reason", async () => {
    const report = await catalog({
      settlement: payToPerChain({ [BASE]: SAFE_ON_BASE }),
    }).describe(MERCHANT);

    expect(report.rails.every((rail) => rail.chain === BASE)).toBe(true);
    expect(report.unavailable).toContainEqual({
      kind: "no-settlement-destination",
      chain: ARC,
      reason: expect.stringContaining("provision a managed wallet"),
    });
  });

  test("a rail the quote layer cannot price is not offered", async () => {
    const report = await catalog({ pricing: pricesAllBut(["ETH"]) }).describe(MERCHANT);

    expect(report.rails.some((rail) => rail.asset === "ETH")).toBe(false);
    expect(report.unavailable).toContainEqual({
      kind: "not-priceable",
      chain: BASE,
      asset: "ETH",
      reason: expect.stringContaining("cannot be priced into USDC"),
    });
  });

  test("a merchant's accepted assets narrow the rails, per chain", async () => {
    const report = await catalog({
      merchantPolicies: policies({ settlementAsset: "USDC", acceptedAssets: ["USDC"] }),
    }).describe(MERCHANT);

    expect(report.rails.map((rail) => `${rail.chain}:${rail.asset}`)).toEqual([
      `${BASE}:USDC`,
      `${ARC}:USDC`,
    ]);
    expect(report.unavailable).toContainEqual({
      kind: "not-accepted",
      chain: BASE,
      asset: "ETH",
      reason: expect.stringContaining("not in the assets you accept"),
    });
  });

  test("a merchant who named no assets is offered what each chain can receive", async () => {
    const report = await catalog({
      merchantPolicies: policies({ settlementAsset: "USDC", acceptedAssets: [] }),
    }).describe(MERCHANT);

    expect(report.rails).toHaveLength(3);
    expect(report.settlementAsset).toBe("USDC");
  });

  test("a Safe deployed on one chain only is refused on the other", async () => {
    const report = await catalog({
      merchantPolicies: policies({
        settlementAsset: "USDC",
        acceptedAssets: [],
        settlementAddress: SAFE_ON_BASE,
      }),
      settlement: payTo(SAFE_ON_BASE),
      code: codeOn([BASE]),
    }).describe(MERCHANT);

    expect(report.rails.every((rail) => rail.chain === BASE)).toBe(true);
    expect(report.unavailable).toContainEqual({
      kind: "settlement-address-has-no-code",
      chain: ARC,
      reason: expect.stringContaining("has no code on arc-testnet"),
    });
  });

  test("an address with code nowhere is an EOA and passes on every chain", async () => {
    const report = await catalog({
      merchantPolicies: policies({
        settlementAsset: "USDC",
        acceptedAssets: [],
        settlementAddress: "0xeoa00000000000000000000000000000000000001",
      }),
      settlement: payTo("0xeoa00000000000000000000000000000000000001"),
      code: codeOn([]),
    }).describe(MERCHANT);

    expect(report.rails).toHaveLength(3);
    expect(report.unavailable).toHaveLength(0);
  });

  test("the code check is skipped for a managed destination the merchant never configured", async () => {
    let asked = 0;
    const report = await catalog({
      merchantPolicies: policies({ settlementAsset: "USDC", acceptedAssets: [] }),
      settlement: payTo(SAFE_ON_BASE),
      code: {
        hasCode: async (chain) => {
          asked += 1;
          return chain === BASE;
        },
      },
    }).describe(MERCHANT);

    // A managed wallet is derived per chain, so it is already the right address
    // for the chain it is returned for. Nothing to cross-check.
    expect(asked).toBe(0);
    expect(report.rails).toHaveLength(3);
  });

  test("a per-chain accept list narrows only that chain", async () => {
    const report = await catalog({
      merchantPolicies: policies({
        settlementAsset: "USDC",
        acceptedAssets: ["ETH", "USDC"],
        acceptedAssetsByChain: { [ARC]: ["USDC"] },
      }),
    }).describe(MERCHANT);

    expect(report.rails.filter((rail) => rail.chain === BASE).map((rail) => rail.asset)).toEqual([
      "USDC",
      "ETH",
    ]);
    expect(report.rails.filter((rail) => rail.chain === ARC).map((rail) => rail.asset)).toEqual([
      "USDC",
    ]);
  });

  test("a chain with no row of its own inherits the merchant-wide accept list", async () => {
    const report = await catalog({
      merchantPolicies: policies({
        settlementAsset: "USDC",
        acceptedAssets: ["USDC"],
        acceptedAssetsByChain: { [BASE]: ["USDC", "ETH"] },
      }),
    }).describe(MERCHANT);

    expect(report.rails.filter((rail) => rail.chain === BASE)).toHaveLength(2);
    expect(report.rails.filter((rail) => rail.chain === ARC)).toHaveLength(1);
  });

  test("a deployment that settles off-chain offers rails with no destination at all", async () => {
    const report = await new DerivedRailCatalog({
      receipts: [BASE_RECEIPT, ARC_RECEIPT],
      merchantPolicies: policies(undefined),
      pricing: PRICES_EVERYTHING,
      defaultSettlementAsset: "USDC",
    }).describe(MERCHANT);

    expect(report.rails).toHaveLength(3);
    expect(report.rails.every((rail) => rail.payTo === undefined)).toBe(true);
    expect(report.unavailable).toHaveLength(0);
  });

  test("no chains configured means no rails, and no throw", async () => {
    const report = await catalog({ receipts: [] }).describe(MERCHANT);

    expect(report.rails).toEqual([]);
    expect(report.unavailable).toEqual([]);
  });
});

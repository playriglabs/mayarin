import { describe, expect, test } from "bun:test";
import {
  acceptedOn,
  applyToAll,
  type NetworkDraft,
  settlementOn,
  settlementOptionsOf,
  toggledAccepted,
} from "./settings-networks";

const SUPPORTED = [
  { chain: "base-sepolia", assets: ["USDC", "EURC", "ETH"], settlementAssets: ["USDC", "EURC"] },
  { chain: "arc-testnet", assets: ["USDC", "EURC"], settlementAssets: ["USDC", "EURC"] },
  { chain: "arbitrum-sepolia", assets: ["USDG", "USDC"], settlementAssets: ["USDG", "USDC"] },
];

const DRAFT: NetworkDraft = {
  settlementAsset: "USDC",
  settlementAssetByChain: {},
  acceptedAssets: [],
  acceptedAssetsByChain: {},
};

describe("settlementOptionsOf", () => {
  test("offers every stablecoin the deployment carries, not a list of its own", () => {
    expect(settlementOptionsOf(SUPPORTED).map((option) => option.value)).toEqual([
      "EURC",
      "USDC",
      "USDG",
    ]);
  });

  test("keeps the current choice while the networks are still loading", () => {
    expect(settlementOptionsOf([], "USDG").map((option) => option.value)).toEqual(["USDG"]);
  });
});

describe("applyToAll", () => {
  test("copies one network's choices as far as each other network can take them", () => {
    const draft: NetworkDraft = {
      ...DRAFT,
      settlementAssetByChain: { "base-sepolia": "EURC" },
      acceptedAssetsByChain: { "base-sepolia": ["EURC", "ETH"] },
    };

    const next = applyToAll(draft, "base-sepolia", SUPPORTED);

    // Arc carries EURC but not ETH, so it takes EURC only, and settles in it.
    expect(acceptedOn(next, "arc-testnet", ["USDC", "EURC"])).toEqual(["EURC"]);
    expect(settlementOn(next, "arc-testnet")).toBe("EURC");
    // Arbitrum carries neither, so it keeps what it had rather than nothing,
    // and cannot settle in EURC.
    expect(next.acceptedAssetsByChain["arbitrum-sepolia"]).toBeUndefined();
    expect(settlementOn(next, "arbitrum-sepolia")).toBe("USDC");
  });

  test("a network left matching its default stores no override", () => {
    const next = applyToAll(DRAFT, "base-sepolia", SUPPORTED);

    // Arc carries exactly what Base accepts that it can: that is its default.
    expect(next.acceptedAssetsByChain["arc-testnet"]).toBeUndefined();
    // Arbitrum can take USDC but not EURC or ETH, and loses USDG by copying.
    expect(next.acceptedAssetsByChain["arbitrum-sepolia"]).toEqual(["USDC"]);
    expect(next.settlementAssetByChain).toEqual({});
  });
});

describe("toggledAccepted", () => {
  const arbitrum = SUPPORTED[2] as (typeof SUPPORTED)[number];

  test("unticks an inherited asset on a network that settles in another one", () => {
    // Merchant-wide USDC only; Arbitrum settles in USDG, which is shown ticked
    // because a network always accepts what it settles in.
    const draft: NetworkDraft = {
      ...DRAFT,
      acceptedAssets: ["USDC"],
      settlementAssetByChain: { "arbitrum-sepolia": "USDG" },
    };
    const next = toggledAccepted(draft, arbitrum, "USDC", false);
    expect(next).toEqual(["USDG"]);

    const saved: NetworkDraft = { ...draft, acceptedAssetsByChain: { "arbitrum-sepolia": next } };
    expect(acceptedOn(saved, "arbitrum-sepolia", arbitrum.assets)).toEqual(["USDG"]);
  });

  test("ticks an asset back on", () => {
    const draft: NetworkDraft = {
      ...DRAFT,
      settlementAssetByChain: { "arbitrum-sepolia": "USDG" },
      acceptedAssetsByChain: { "arbitrum-sepolia": ["USDG"] },
    };
    expect(toggledAccepted(draft, arbitrum, "USDC", true)).toEqual(["USDG", "USDC"]);
  });
});

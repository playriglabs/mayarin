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
  { chain: "robinhood-testnet", assets: ["USDG", "USDC"], settlementAssets: ["USDG", "USDC"] },
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
    // Robinhood carries neither, so it keeps what it had rather than nothing,
    // and cannot settle in EURC.
    expect(next.acceptedAssetsByChain["robinhood-testnet"]).toBeUndefined();
    expect(settlementOn(next, "robinhood-testnet")).toBe("USDC");
  });

  test("a network left matching its default stores no override", () => {
    const next = applyToAll(DRAFT, "base-sepolia", SUPPORTED);

    // Arc carries exactly what Base accepts that it can: that is its default.
    expect(next.acceptedAssetsByChain["arc-testnet"]).toBeUndefined();
    // Robinhood can take USDC but not EURC or ETH, and loses USDG by copying.
    expect(next.acceptedAssetsByChain["robinhood-testnet"]).toEqual(["USDC"]);
    expect(next.settlementAssetByChain).toEqual({});
  });
});

describe("toggledAccepted", () => {
  const robinhood = SUPPORTED[2] as (typeof SUPPORTED)[number];

  test("unticks an inherited asset on a network that settles in another one", () => {
    // Merchant-wide USDC only; Robinhood settles in USDG, which is shown ticked
    // because a network always accepts what it settles in.
    const draft: NetworkDraft = {
      ...DRAFT,
      acceptedAssets: ["USDC"],
      settlementAssetByChain: { "robinhood-testnet": "USDG" },
    };
    const next = toggledAccepted(draft, robinhood, "USDC", false);
    expect(next).toEqual(["USDG"]);

    const saved: NetworkDraft = { ...draft, acceptedAssetsByChain: { "robinhood-testnet": next } };
    expect(acceptedOn(saved, "robinhood-testnet", robinhood.assets)).toEqual(["USDG"]);
  });

  test("ticks an asset back on", () => {
    const draft: NetworkDraft = {
      ...DRAFT,
      settlementAssetByChain: { "robinhood-testnet": "USDG" },
      acceptedAssetsByChain: { "robinhood-testnet": ["USDG"] },
    };
    expect(toggledAccepted(draft, robinhood, "USDC", true)).toEqual(["USDG", "USDC"]);
  });
});

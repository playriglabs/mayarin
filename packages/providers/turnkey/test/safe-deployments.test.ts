import { describe, expect, test } from "bun:test";
import {
  SAFE_ARC_TESTNET,
  SAFE_BASE_SEPOLIA,
  SAFE_DEPLOYMENTS,
  safeDeploymentFor,
} from "../src/wallet-provider.ts";

describe("Safe deployments", () => {
  test("Arc uses the canonical 1.4.1 addresses, verified on that chain", () => {
    // Same addresses as Base because Safe's deterministic deployment put them
    // there — checked on Arc rather than assumed: proxy factory 3055 bytes,
    // SafeL2 singleton 24422, fallback handler 5638.
    expect(SAFE_ARC_TESTNET).toEqual(SAFE_BASE_SEPOLIA);
  });

  test("resolves a chain it has verified", () => {
    expect(safeDeploymentFor("arc-testnet")).toBe(SAFE_ARC_TESTNET);
    expect(safeDeploymentFor("base-sepolia")).toBe(SAFE_BASE_SEPOLIA);
  });

  test("refuses a chain nobody has read the addresses off", () => {
    // Falling back to another chain's table would deploy a wallet at an address
    // nobody predicted, because the salt already carries the chain.
    expect(() => safeDeploymentFor("robinhood-testnet")).toThrow(/No verified Safe deployment/);
  });

  test("only names chains it can actually serve", () => {
    expect(Object.keys(SAFE_DEPLOYMENTS).sort()).toEqual(["arc-testnet", "base-sepolia"]);
  });
});

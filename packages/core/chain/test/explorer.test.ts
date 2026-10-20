import { describe, expect, test } from "bun:test";
import { addressExplorerUrl, transactionExplorerUrl } from "../src/explorer.ts";

const HASH = `0x${"ab".repeat(32)}`;
const ADDRESS = `0x${"12".repeat(20)}`;
const SOLANA_SIGNATURE =
  "4aHJemPREHHP2brZMBQH37sy7YiAS8WY4sYDXq85bwT58KirhWkUUZnXi88orzynPiovHxqbWWHN76Z4CP7rVima";
const SOLANA_ADDRESS = "56qSN5FG1utffJucpRiSm71y5dLBqDMS8XynpZVuuD6f";

describe("transactionExplorerUrl", () => {
  test("builds Ethereum Sepolia transaction links", () => {
    expect(transactionExplorerUrl("ethereum-sepolia", HASH)).toBe(
      `https://sepolia.etherscan.io/tx/${HASH}`,
    );
  });

  test("builds Base and Base Sepolia transaction links", () => {
    expect(transactionExplorerUrl("base", HASH)).toBe(`https://basescan.org/tx/${HASH}`);
    expect(transactionExplorerUrl("base-sepolia", HASH)).toBe(
      `https://sepolia.basescan.org/tx/${HASH}`,
    );
  });

  test("builds Arc transaction links", () => {
    expect(transactionExplorerUrl("arc-testnet", HASH)).toBe(
      `https://testnet.arcscan.app/tx/${HASH}`,
    );
  });

  test("builds Solana Devnet transaction links", () => {
    expect(transactionExplorerUrl("solana-devnet", SOLANA_SIGNATURE)).toBe(
      `https://explorer.solana.com/tx/${SOLANA_SIGNATURE}?cluster=devnet`,
    );
  });

  test("does not turn internal references or unsupported chains into links", () => {
    expect(transactionExplorerUrl("base-sepolia", "stl_01KZ")).toBeUndefined();
    expect(transactionExplorerUrl("optimism", HASH)).toBeUndefined();
  });
});

describe("addressExplorerUrl", () => {
  test("builds Ethereum Sepolia address links", () => {
    expect(addressExplorerUrl("ethereum-sepolia", ADDRESS)).toBe(
      `https://sepolia.etherscan.io/address/${ADDRESS}`,
    );
  });

  test("builds Base and Base Sepolia address links", () => {
    expect(addressExplorerUrl("base", ADDRESS)).toBe(`https://basescan.org/address/${ADDRESS}`);
    expect(addressExplorerUrl("base-sepolia", ADDRESS)).toBe(
      `https://sepolia.basescan.org/address/${ADDRESS}`,
    );
  });

  test("builds Arc address links", () => {
    expect(addressExplorerUrl("arc-testnet", ADDRESS)).toBe(
      `https://testnet.arcscan.app/address/${ADDRESS}`,
    );
  });

  test("builds Solana Devnet address links", () => {
    expect(addressExplorerUrl("solana-devnet", SOLANA_ADDRESS)).toBe(
      `https://explorer.solana.com/address/${SOLANA_ADDRESS}?cluster=devnet`,
    );
  });

  test("does not turn an internal id or an unsupported chain into a link", () => {
    expect(addressExplorerUrl("base-sepolia", "pi_01KZ")).toBeUndefined();
    expect(addressExplorerUrl("optimism", ADDRESS)).toBeUndefined();
  });
});

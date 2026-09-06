import { describe, expect, test } from "bun:test";
import { fromDecimalString, toDecimalString } from "@mayarin/shared";
import { EvmChainClient } from "../src/client.ts";
import { validateNativeAssets } from "../src/native-assets.ts";
import { EvmWalletBalanceReader } from "../src/wallet-balances.ts";

const ADDRESS = `0x${"12".repeat(20)}`;
const USDC = "0x3600000000000000000000000000000000000000";

describe("Arc's one USDC holding", () => {
  test("reads only the six-decimal token view and round-trips without losing Base ETH precision", async () => {
    const calls: string[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = (await request.json()) as { id: number; method: string };
        calls.push(body.method);
        const amount = body.method === "eth_call" ? 1_234_567n : 1_234_567_890_123_456_789n;
        const result = `0x${amount.toString(16).padStart(64, "0")}`;
        return Response.json({ jsonrpc: "2.0", id: body.id, result });
      },
    });
    try {
      const url = `http://localhost:${server.port}`;
      const reader = new EvmWalletBalanceReader({
        rpcUrls: { "arc-testnet": url, "base-sepolia": url },
        tokens: { "arc-testnet": { USDC } },
        nativeAssets: { "base-sepolia": "ETH" },
      });
      const arc = await reader.balances({
        chain: "arc-testnet",
        address: ADDRESS,
        assets: ["USDC"],
      });
      expect(arc).toEqual([fromDecimalString("1.234567", "USDC")]);
      expect(calls).toEqual(["eth_call"]);
      const base = await reader.balances({
        chain: "base-sepolia",
        address: ADDRESS,
        assets: ["ETH"],
      });
      expect(base).toEqual([fromDecimalString("1.234567890123456789", "ETH")]);
      for (const balance of [...arc, ...base]) {
        expect(fromDecimalString(toDecimalString(balance), balance.asset)).toEqual(balance);
      }
    } finally {
      server.stop(true);
    }
  });

  test("refuses the 18-decimal native view as six-decimal domain USDC before any RPC", () => {
    const options = { rpcUrls: {}, tokens: {}, nativeAssets: { "arc-testnet": "USDC" } } as const;
    expect(() => new EvmWalletBalanceReader(options)).toThrow(/ERC-20/);
    expect(() => new EvmChainClient(options)).toThrow(/ERC-20/);
    expect(() => validateNativeAssets(options.nativeAssets)).toThrow(/ERC-20/);
    expect(() => validateNativeAssets({ "arc-testnet": "ETH" })).toThrow(/domain asset/);
    expect(() => validateNativeAssets({ "base-sepolia": "ETH" })).not.toThrow();
  });
});

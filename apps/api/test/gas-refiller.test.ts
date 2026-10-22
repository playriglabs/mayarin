import { describe, expect, test } from "bun:test";
import type { ChainId } from "@mayarin/chain";
import { type Address, decodeFunctionData, encodeAbiParameters, getAddress, parseAbi } from "viem";
import {
  ALLOWANCE_MODULE,
  allowanceModuleAbi,
  GasRefiller,
  type GasRefillRoute,
  LIFI_DIAMOND,
} from "../src/services/gas-refiller.ts";

const SAFE = getAddress("0x6e97f117D9f34A6711Bd70940f9D165bD8C389d3");
const OPERATOR = getAddress("0x3Fd1D43bFEfFf717A064FebBD7c0bD370f09c2F6");
const USDC = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");

const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
]);

const word = (value: bigint) => encodeAbiParameters([{ type: "uint256" }], [value]).slice(2);

interface World {
  native: bigint;
  operatorUsdc: bigint;
  safeUsdc: bigint;
  moduleAmount: bigint;
  moduleSpent: bigint;
  erc20Allowance: bigint;
  sent: Array<{ to: string; name: string }>;
}

function setup(world: World, route?: Partial<GasRefillRoute>) {
  const refiller = new GasRefiller({
    chains: { base: { asset: "USDC", amount: "5", min: "0.002" } },
    tokens: { base: { USDC } },
    safe: SAFE,
    operator: OPERATOR,
    port: {
      async nativeBalance() {
        return world.native;
      },
      async read(_chain: ChainId, to: Address, data) {
        if (to === ALLOWANCE_MODULE) {
          const words = [world.moduleAmount, world.moduleSpent, 1_440n, 0n, 1n].map(word).join("");
          return `0x${words}`;
        }
        const call = decodeFunctionData({ abi: erc20Abi, data });
        if (call.functionName === "allowance") return `0x${word(world.erc20Allowance)}`;
        const holder = (call.args as readonly [Address])[0];
        return `0x${word(holder === SAFE ? world.safeUsdc : world.operatorUsdc)}`;
      },
      async send(_chain, to, data) {
        if (to === ALLOWANCE_MODULE) {
          const call = decodeFunctionData({ abi: allowanceModuleAbi, data });
          expect(call.functionName).toBe("executeAllowanceTransfer");
          // An empty signature authenticates the operator as the delegate.
          expect(call.args?.[7]).toBe("0x");
          world.operatorUsdc += call.args?.[3] as bigint;
          world.safeUsdc -= call.args?.[3] as bigint;
          world.sent.push({ to, name: "pull" });
        } else if (to === USDC) {
          world.sent.push({ to, name: "approve" });
        } else {
          world.operatorUsdc = 0n;
          world.sent.push({ to, name: "swap" });
        }
        return "0xhash";
      },
    },
    async route() {
      return {
        to: LIFI_DIAMOND,
        data: "0xabcdef",
        value: 0n,
        approvalAddress: LIFI_DIAMOND,
        toAmountMin: 1n,
        ...route,
      };
    },
  });
  return refiller;
}

const fresh = (patch: Partial<World> = {}): World => ({
  native: 0n,
  operatorUsdc: 0n,
  safeUsdc: 100_000_000n,
  moduleAmount: 20_000_000n,
  moduleSpent: 0n,
  erc20Allowance: 0n,
  sent: [],
  ...patch,
});

describe("GasRefiller", () => {
  test("does nothing while the operator holds enough native", async () => {
    const world = fresh({ native: 3_000_000_000_000_000n });
    expect(await setup(world).run()).toEqual([]);
    expect(world.sent).toEqual([]);
  });

  test("pulls from the Safe, approves and swaps when the operator is low", async () => {
    const world = fresh();
    const findings = await setup(world).run();
    expect(findings).toEqual([{ type: "gas-refill", chain: "base", result: "refilled" }]);
    expect(world.sent.map((call) => call.name)).toEqual(["pull", "approve", "swap"]);
    expect(world.safeUsdc).toBe(95_000_000n);
  });

  test("a pass that crashed after the pull swaps without pulling again", async () => {
    const world = fresh({ operatorUsdc: 5_000_000n, erc20Allowance: 5_000_000n });
    await setup(world).run();
    expect(world.sent.map((call) => call.name)).toEqual(["swap"]);
    expect(world.safeUsdc).toBe(100_000_000n);
  });

  test("reports an exhausted allowance and moves nothing", async () => {
    const world = fresh({ moduleSpent: 18_000_000n });
    const findings = await setup(world).run();
    expect(findings).toEqual([
      { type: "gas-refill", chain: "base", result: "allowance-exhausted" },
    ]);
    expect(world.sent).toEqual([]);
  });

  test("reports an empty Safe", async () => {
    const world = fresh({ safeUsdc: 1_000_000n });
    const findings = await setup(world).run();
    expect(findings).toEqual([{ type: "gas-refill", chain: "base", result: "safe-empty" }]);
    expect(world.sent).toEqual([]);
  });

  test("refuses a route that calls anything but LiFi's diamond", async () => {
    const world = fresh({ operatorUsdc: 5_000_000n });
    const findings = await setup(world, { to: "0x000000000000000000000000000000000000dEaD" }).run();
    expect(findings[0]?.result).toBe("failed");
    expect(world.sent).toEqual([]);
  });

  test("refuses a route that sends native or delivers nothing", async () => {
    for (const bad of [{ value: 1n }, { toAmountMin: 0n }]) {
      const world = fresh({ operatorUsdc: 5_000_000n });
      const findings = await setup(world, bad).run();
      expect(findings[0]?.result).toBe("failed");
      expect(world.sent).toEqual([]);
    }
  });

  test("one failing chain does not stop the others", async () => {
    const calls: string[] = [];
    const refiller = new GasRefiller({
      chains: {
        base: { asset: "USDC", amount: "5", min: "0.002" },
        polygon: { asset: "USDC", amount: "5", min: "1" },
      },
      tokens: { base: { USDC }, polygon: { USDC } },
      safe: SAFE,
      operator: OPERATOR,
      port: {
        async nativeBalance(chain) {
          calls.push(chain);
          if (chain === "base") throw new Error("rpc down");
          return 10n ** 18n * 5n;
        },
        async read() {
          return "0x";
        },
        async send() {
          return "0x";
        },
      },
      async route() {
        throw new Error("unused");
      },
    });
    const findings = await refiller.run();
    expect(calls).toEqual(["base", "polygon"]);
    expect(findings).toEqual([
      { type: "gas-refill", chain: "base", result: "failed", detail: "rpc down" },
    ]);
  });

  test("refuses to start with a stablecoin that has no token address on the chain", () => {
    expect(
      () =>
        new GasRefiller({
          chains: { base: { asset: "USDG", amount: "5", min: "0.002" } },
          tokens: { base: { USDC } },
          safe: SAFE,
          operator: OPERATOR,
          port: { nativeBalance: async () => 0n, read: async () => "0x", send: async () => "0x" },
          route: async () => {
            throw new Error("unused");
          },
        }),
    ).toThrow(/no token address/);
  });
});

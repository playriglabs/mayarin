import { describe, expect, test } from "bun:test";
import { FixedClock } from "@mayarin/shared";
import { rpcMerchantRegistry } from "../src/services/merchant-registry.ts";

const ROUTER = "0x00000000000000000000000000000000000000aa";
const SAFE = "0x00000000000000000000000000000000000000bb";

function registry(
  behaviour: {
    enforced?: boolean | Error;
    registered?: boolean;
  },
  clock = new FixedClock("2026-01-01T00:00:00.000Z"),
) {
  const calls: string[] = [];
  const instance = rpcMerchantRegistry({
    rpcUrls: {},
    routers: { "base-sepolia": ROUTER },
    clock,
    read: async (_chain, _router, functionName) => {
      calls.push(functionName);
      if (functionName === "merchantRegistryEnforced") {
        if (behaviour.enforced instanceof Error) throw behaviour.enforced;
        return behaviour.enforced ?? false;
      }
      return behaviour.registered ?? false;
    },
  });
  return { instance, calls, clock };
}

/** What viem raises for a function the contract does not have, wrapped as it wraps it. */
const absentFunction = () => {
  const root = Object.assign(new Error("reverted"), { name: "ContractFunctionRevertedError" });
  return new Error("execution failed", { cause: root });
};

describe("rpcMerchantRegistry (SEC-06)", () => {
  test("a router that does not enforce pays anyone, and the destination is not even asked about", async () => {
    const { instance, calls } = registry({ enforced: false });
    await instance.assertPayable("base-sepolia", SAFE);
    expect(calls).toEqual(["merchantRegistryEnforced"]);
  });

  test("an enforcing router refuses an unregistered destination, with a reason", async () => {
    const { instance } = registry({ enforced: true, registered: false });
    await expect(instance.assertPayable("base-sepolia", SAFE)).rejects.toThrow(
      /not registered on the base-sepolia PaymentRouter/,
    );
  });

  test("an enforcing router pays a registered destination", async () => {
    const { instance } = registry({ enforced: true, registered: true });
    await instance.assertPayable("base-sepolia", SAFE);
  });

  test("a router from before the registry reads as not enforcing", async () => {
    const { instance } = registry({ enforced: absentFunction() });
    await instance.assertPayable("base-sepolia", SAFE);
  });

  test("an RPC that is down is an error, never a pass", async () => {
    const { instance } = registry({ enforced: new Error("fetch failed") });
    await expect(instance.assertPayable("base-sepolia", SAFE)).rejects.toThrow("fetch failed");
  });

  test("a chain with no router is not this check's business", async () => {
    const { instance, calls } = registry({ enforced: true });
    await instance.assertPayable("arc-testnet", SAFE);
    expect(calls).toEqual([]);
  });

  test("the enforcement answer is kept for a minute, then read again", async () => {
    const { instance, calls, clock } = registry({ enforced: true, registered: true });
    await instance.assertPayable("base-sepolia", SAFE);
    await instance.assertPayable("base-sepolia", SAFE);
    expect(calls.filter((name) => name === "merchantRegistryEnforced")).toHaveLength(1);

    clock.advance(60_001);
    await instance.assertPayable("base-sepolia", SAFE);
    expect(calls.filter((name) => name === "merchantRegistryEnforced")).toHaveLength(2);
  });
});

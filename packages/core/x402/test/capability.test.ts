import { describe, expect, test } from "bun:test";
import type { AssetCapability, AssetCapabilityProbe } from "../src/capability.ts";
import { AssetCapabilities } from "../src/capability.ts";

const CHAIN = "base-sepolia" as const;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

function capabilityOf(contract: string): AssetCapability {
  return {
    chain: CHAIN,
    contract,
    transferMethod: "eip3009",
    domain: { name: "USDC", version: "2" },
    supportsPermit: true,
  };
}

/** A probe that counts its calls, so caching is observable. */
function countingProbe(answer: (contract: string) => Promise<AssetCapability>) {
  const calls: string[] = [];
  const probe: AssetCapabilityProbe = {
    chain: CHAIN,
    probe(contract) {
      calls.push(contract);
      return answer(contract);
    },
  };
  return { probe, calls };
}

describe("AssetCapabilities", () => {
  test("asks the chain once per token", async () => {
    const { probe, calls } = countingProbe(async (contract) => capabilityOf(contract));
    const capabilities = new AssetCapabilities({ probes: [probe], pairs: [] });

    const first = await capabilities.of(CHAIN, USDC);
    const second = await capabilities.of(CHAIN, USDC);

    expect(first.transferMethod).toBe("eip3009");
    expect(second).toBe(first);
    expect(calls).toEqual([USDC]);
  });

  test("two concurrent lookups share one call", async () => {
    const { probe, calls } = countingProbe(async (contract) => capabilityOf(contract));
    const capabilities = new AssetCapabilities({ probes: [probe], pairs: [] });

    await Promise.all([capabilities.of(CHAIN, USDC), capabilities.of(CHAIN, USDC)]);

    expect(calls).toEqual([USDC]);
  });

  test("the same token in different case is the same token", async () => {
    const { probe, calls } = countingProbe(async (contract) => capabilityOf(contract));
    const capabilities = new AssetCapabilities({ probes: [probe], pairs: [] });

    await capabilities.of(CHAIN, USDC);
    await capabilities.of(CHAIN, USDC.toLowerCase());

    expect(calls).toEqual([USDC]);
  });

  test("a failed probe is asked again rather than remembered", async () => {
    let attempt = 0;
    const { probe, calls } = countingProbe(async (contract) => {
      attempt += 1;
      if (attempt === 1) throw new Error("rpc down");
      return capabilityOf(contract);
    });
    const capabilities = new AssetCapabilities({ probes: [probe], pairs: [] });

    await expect(capabilities.of(CHAIN, USDC)).rejects.toThrow("rpc down");
    await expect(capabilities.of(CHAIN, USDC)).resolves.toMatchObject({
      transferMethod: "eip3009",
    });
    expect(calls).toHaveLength(2);
  });

  test("a chain with no probe is a configuration error, not a guess", async () => {
    const capabilities = new AssetCapabilities({ probes: [], pairs: [] });

    await expect(capabilities.of(CHAIN, USDC)).rejects.toThrow(/no capability probe/i);
  });

  test("warmUp asks every configured pair", async () => {
    const other = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
    const { probe, calls } = countingProbe(async (contract) => capabilityOf(contract));
    const capabilities = new AssetCapabilities({
      probes: [probe],
      pairs: [
        { chain: CHAIN, contract: USDC },
        { chain: CHAIN, contract: other },
      ],
    });

    await capabilities.warmUp();

    expect(calls).toEqual([USDC, other]);
  });

  test("warmUp fails when a configured token cannot be described", async () => {
    const { probe } = countingProbe(async () => {
      throw new Error("answers an invented selector");
    });
    const capabilities = new AssetCapabilities({
      probes: [probe],
      pairs: [{ chain: CHAIN, contract: USDC }],
    });

    await expect(capabilities.warmUp()).rejects.toThrow("answers an invented selector");
  });
});

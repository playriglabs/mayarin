import { describe, expect, test } from "bun:test";
import { ConfigurationError } from "@mayarin/shared";
import type { PublicClient } from "viem";
import { EvmAssetCapabilityProbe } from "../src/probe.ts";
import { ASSET, CHAIN } from "./harness.ts";

/**
 * A contract that answers exactly the selectors a test names, and reverts on
 * everything else — which is what a real contract does, and the property the
 * probe depends on.
 */
function token(answers: Readonly<Record<string, unknown>>): PublicClient {
  return {
    async readContract({ functionName }: { functionName: string }) {
      if (!(functionName in answers)) throw new Error("execution reverted");
      return answers[functionName];
    },
  } as unknown as PublicClient;
}

function probeFor(answers: Readonly<Record<string, unknown>>): EvmAssetCapabilityProbe {
  return new EvmAssetCapabilityProbe({ chain: CHAIN, publicClient: token(answers) });
}

describe("EvmAssetCapabilityProbe", () => {
  // The shape measured on Arc testnet on 3 September: a FiatTokenV2 behind a
  // proxy, implementing both EIP-3009 and EIP-2612, on a chain whose own
  // documentation mentions neither.
  test("finds EIP-3009 on a token that implements it", async () => {
    const capability = await probeFor({
      name: "USDC",
      version: "2",
      authorizationState: false,
      nonces: 0n,
    }).probe(ASSET);

    expect(capability).toEqual({
      chain: CHAIN,
      contract: ASSET,
      transferMethod: "eip3009",
      domain: { name: "USDC", version: "2" },
      supportsPermit: true,
    });
  });

  // The value is irrelevant. `authorizationState` for an unused nonce is
  // `false` and `nonces` for a fresh address is `0`; what is being tested is
  // that the selector exists at all.
  test("reads a falsy answer as the selector existing", async () => {
    const capability = await probeFor({
      name: "USDC",
      version: "2",
      authorizationState: false,
      nonces: 0n,
    }).probe(ASSET);

    expect(capability.transferMethod).toBe("eip3009");
  });

  test("falls back to permit2 for a plain ERC-20", async () => {
    const capability = await probeFor({ name: "Token", version: "1" }).probe(ASSET);

    expect(capability.transferMethod).toBe("permit2");
    expect(capability.supportsPermit).toBe(false);
  });

  test("notes EIP-2612 on a token that has permit but not 3009", async () => {
    const capability = await probeFor({ name: "Token", version: "1", nonces: 3n }).probe(ASSET);

    expect(capability).toMatchObject({ transferMethod: "permit2", supportsPermit: true });
  });

  // The control is what makes every other answer here evidence. A contract
  // answering every selector would otherwise be described as EIP-3009 capable,
  // and every payment against it would fail at settlement.
  test("refuses a contract that answers an invented selector", async () => {
    const permissive = probeFor({
      name: "USDC",
      version: "2",
      authorizationState: false,
      nonces: 0n,
      mayarinProbeControl: 0n,
    });

    expect(permissive.probe(ASSET)).rejects.toThrow(/invented selector/);
  });

  test("the refusal is a configuration error, so it stops a boot", async () => {
    const permissive = probeFor({ name: "USDC", version: "2", mayarinProbeControl: 0n });

    expect(permissive.probe(ASSET)).rejects.toBeInstanceOf(ConfigurationError);
  });

  // Without a domain there is no typed data for a payer to sign, so this asset
  // cannot appear in `accepts` at all. Guessing `{USDC, 2}` would produce
  // signatures the token rejects.
  test.each([
    ["no name", { version: "2", authorizationState: false }],
    ["no version", { name: "USDC", authorizationState: false }],
  ])("refuses a token reporting %s", async (_label, answers) => {
    expect(probeFor(answers).probe(ASSET)).rejects.toThrow(/EIP-712 domain/);
  });
});

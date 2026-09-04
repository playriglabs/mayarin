/**
 * What a token can actually do, asked of the token.
 *
 * Which `assetTransferMethod` a `(chain, asset)` pair advertises decides
 * whether a payer signs an EIP-3009 authorization or a Permit2 one, and the
 * token's EIP-712 domain decides whether their signature verifies at all. Both
 * are facts about a deployed contract, so both are read from it.
 *
 * This is not fastidiousness. Arc's documentation describes its USDC interface
 * as `transferFrom`, `approve` and allowances, and mentions EIP-3009 nowhere;
 * the contract implements it. A deployment configured from that documentation
 * would have advertised `permit2` on a chain where the proxy Permit2 needs is
 * not even deployed, and every payment on it would have failed. The probe read
 * the chain and got the right answer in one call.
 *
 * **The control call is the part that makes the rest mean anything.** A
 * contract that answers every selector with zeroes would pass an EIP-3009 check
 * that consists of "did `authorizationState` return something". So an invented
 * selector is called first, and a contract that answers it is refused rather
 * than described — the probe cannot tell truth from noise there, and saying so
 * is the only honest option.
 */

import type { ChainId } from "@mayarin/chain";
import { ConfigurationError } from "@mayarin/shared";
import type { AssetCapability, AssetCapabilityProbe } from "@mayarin/x402";
import { type Address, type Hex, type PublicClient, parseAbi } from "viem";

const probeAbi = parseAbi([
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function decimals() view returns (uint8)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "function nonces(address owner) view returns (uint256)",
  // Deliberately not a function. If this answers, nothing else the probe asks
  // is evidence of anything.
  "function mayarinProbeControl() view returns (uint256)",
]);

/** An address and a nonce nobody uses, for the two existence probes. */
const PROBE_ADDRESS: Address = "0x0000000000000000000000000000000000000001";
const PROBE_NONCE: Hex = `0x${"00".repeat(31)}01`;

export interface AssetCapabilityProbeOptions {
  readonly chain: ChainId;
  readonly publicClient: PublicClient;
}

export class EvmAssetCapabilityProbe implements AssetCapabilityProbe {
  readonly chain: ChainId;
  readonly #client: PublicClient;

  constructor(options: AssetCapabilityProbeOptions) {
    this.chain = options.chain;
    this.#client = options.publicClient;
  }

  async probe(contract: string): Promise<AssetCapability> {
    const address = contract as Address;

    // Control first. A contract with a permissive fallback makes every
    // subsequent answer meaningless, and it is better to refuse to describe it
    // than to describe it wrongly.
    if (
      await this.#answers(
        this.#client.readContract({
          address,
          abi: probeAbi,
          functionName: "mayarinProbeControl",
        }),
      )
    ) {
      throw new ConfigurationError(
        `${contract} on ${this.chain} answers an invented selector, so its capabilities cannot be probed`,
        { chain: this.chain, contract },
      );
    }

    const [name, version] = await Promise.all([
      this.#read(address, "name"),
      this.#read(address, "version"),
    ]);
    if (typeof name !== "string" || typeof version !== "string") {
      throw new ConfigurationError(
        `${contract} on ${this.chain} does not report an EIP-712 domain; a payer's signature cannot be built for it`,
        { chain: this.chain, contract },
      );
    }

    const [supports3009, supportsPermit] = await Promise.all([
      this.#answers(
        this.#client.readContract({
          address,
          abi: probeAbi,
          functionName: "authorizationState",
          args: [PROBE_ADDRESS, PROBE_NONCE],
        }),
      ),
      this.#answers(
        this.#client.readContract({
          address,
          abi: probeAbi,
          functionName: "nonces",
          args: [PROBE_ADDRESS],
        }),
      ),
    ]);

    return {
      chain: this.chain,
      contract,
      // EIP-3009 first, as the specification prescribes: it is one transaction
      // and needs no prior approval from the payer.
      transferMethod: supports3009 ? "eip3009" : "permit2",
      domain: { name, version },
      supportsPermit,
    };
  }

  async #read(address: Address, functionName: "name" | "version"): Promise<unknown> {
    try {
      return await this.#client.readContract({ address, abi: probeAbi, functionName });
    } catch {
      return undefined;
    }
  }

  /**
   * Whether a call returns at all.
   *
   * Takes the call already built rather than its parts, so each read is typed
   * by the ABI at the site that makes it. The alternative — one helper taking a
   * function name and loose arguments — needs `any` to typecheck, and `any` is
   * how a probe ends up encoding arguments that do not match the selector it
   * claims to be testing.
   *
   * The returned value is irrelevant: `authorizationState` for an unused nonce
   * is `false`, and `nonces` for a fresh address is `0`. What is being tested
   * is that the selector exists, and a contract without it reverts.
   */
  async #answers(call: Promise<unknown>): Promise<boolean> {
    try {
      await call;
      return true;
    } catch {
      return false;
    }
  }
}

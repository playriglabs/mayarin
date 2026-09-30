/**
 * What a token can do, asked of the token.
 *
 * The port lives here and the EVM implementation lives in a provider, for the
 * usual reason — but also for a specific one. Two of this rail's fields cannot
 * be configured correctly by reading anybody's documentation: whether a token
 * implements EIP-3009, and what its EIP-712 domain is. Arc's own documentation
 * describes its USDC as `approve`/`transferFrom` and never mentions EIP-3009;
 * the contract implements it. A deployment configured from that page would have
 * advertised `permit2` on a chain whose Permit2 proxy is not deployed, and
 * every payment on it would have failed.
 *
 * So a `(chain, contract)` pair is described by asking it, and this registry is
 * where the answers are kept.
 */

import type { ChainId } from "@mayarin/chain";
import { ConfigurationError } from "@mayarin/shared";
import type { AssetTransferMethod } from "./types.ts";

/** What a probe found. Every field comes off the contract. */
export interface AssetCapability {
  readonly chain: ChainId;
  readonly contract: string;
  readonly transferMethod: AssetTransferMethod;
  /** The token's EIP-712 domain, as the token reports it. */
  readonly domain: { readonly name: string; readonly version: string };
  /** True when the token also implements EIP-2612, which the permit2 path can use. */
  readonly supportsPermit: boolean;
}

/** One chain's probe. A deployment holds one per chain it can reach. */
export interface AssetCapabilityProbe {
  readonly chain: ChainId;
  probe(contract: string): Promise<AssetCapability>;
}

/** A `(chain, contract)` the deployment expects to be able to serve. */
export interface AssetPair {
  readonly chain: ChainId;
  readonly contract: string;
}

export interface AssetCapabilitiesOptions {
  readonly probes: readonly AssetCapabilityProbe[];
  /** Everything `warmUp` asks about. Lazy lookups are not limited to it. */
  readonly pairs: readonly AssetPair[];
}

/**
 * The deployment's answers, asked once per pair.
 *
 * The cache holds the in-flight promise rather than the resolved value, so two
 * requests arriving together for the same token make one call rather than two —
 * and so `warmUp` and a first request that races it cannot both probe.
 *
 * A failed probe is not cached. An RPC that was down when a resource was first
 * asked for should not keep that token unusable for the life of the process.
 */
export class AssetCapabilities {
  readonly #probes: ReadonlyMap<ChainId, AssetCapabilityProbe>;
  readonly #pairs: readonly AssetPair[];
  readonly #asked = new Map<string, Promise<AssetCapability>>();

  constructor(options: AssetCapabilitiesOptions) {
    this.#probes = new Map(options.probes.map((probe) => [probe.chain, probe]));
    this.#pairs = options.pairs;
  }

  /**
   * Ask every configured pair up front, and report the ones that cannot be
   * described.
   *
   * Reported rather than thrown: a settlement stablecoin with no EIP-712
   * domain (Robinhood's USDC and USDG, Arbitrum's USDG) is still a valid asset
   * for the contract and deposit paths — it is only not an x402 token. A
   * request already drops such a token, so refusing to start over one took the
   * whole API down for a rail nobody could have used.
   */
  async warmUp(): Promise<readonly { readonly pair: AssetPair; readonly reason: string }[]> {
    const results = await Promise.allSettled(
      this.#pairs.map((pair) => this.of(pair.chain, pair.contract)),
    );
    return results.flatMap((result, index) => {
      const pair = this.#pairs[index];
      if (result.status === "fulfilled" || pair === undefined) return [];
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      return [{ pair, reason }];
    });
  }

  /** The capability of one token, from cache or from the chain. */
  of(chain: ChainId, contract: string): Promise<AssetCapability> {
    const key = keyOf(chain, contract);
    const asked = this.#asked.get(key);
    if (asked !== undefined) return asked;

    const probe = this.#probes.get(chain);
    if (probe === undefined) {
      return Promise.reject(
        new ConfigurationError(
          `No capability probe for ${chain}: it has no CHAIN_RPC_URLS entry, so nothing can ask its tokens what they implement`,
          { chain, contract },
        ),
      );
    }

    const pending = probe.probe(contract);
    this.#asked.set(key, pending);
    pending.catch(() => this.#asked.delete(key));
    return pending;
  }
}

function keyOf(chain: ChainId, contract: string): string {
  return `${chain}:${contract.toLowerCase()}`;
}

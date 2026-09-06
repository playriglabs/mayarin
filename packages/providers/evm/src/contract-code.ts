/**
 * Whether an address is a contract on a given chain (#244).
 *
 * One question, asked for one reason: `merchants.settlement_address` is a
 * single value that wins on **every** chain, so a merchant who set it to a Safe
 * deployed on Base is otherwise paid to that same address on Arc, where it has
 * no code. The payment settles, and the money sits at an address nobody can
 * spend from.
 *
 * An address with code on one configured chain and none on another is a
 * contract, and a contract does not exist on a chain it was not deployed to.
 * An address with code nowhere is an EOA, and the same key controls it
 * everywhere — which is why the answer is only interesting in comparison
 * across chains, never on one chain alone.
 *
 * Answers are cached for the life of the process. Code at an address is
 * effectively immutable — deployment is the one transition, and it goes one way
 * — so re-asking on every page load spends an RPC call on an answer that
 * cannot have changed. A freshly deployed Safe is the exception, and it is
 * covered by the cache being per process rather than persisted.
 */

import type { ChainId, ContractCodeSource } from "@mayarin/chain";
import { VIEM_CHAINS } from "@mayarin/provider-viem-chains";
import { ProviderError } from "@mayarin/shared";
import { createPublicClient, getAddress, http, type PublicClient } from "viem";

export interface EvmContractCodeReaderOptions {
  readonly rpcUrls: Readonly<Partial<Record<ChainId, string>>>;
}

export class EvmContractCodeReader implements ContractCodeSource {
  readonly #rpcUrls: EvmContractCodeReaderOptions["rpcUrls"];
  readonly #clients = new Map<ChainId, PublicClient>();
  readonly #answers = new Map<string, boolean>();

  constructor(options: EvmContractCodeReaderOptions) {
    this.#rpcUrls = options.rpcUrls;
  }

  async hasCode(chain: ChainId, address: string): Promise<boolean> {
    const key = `${chain}:${address.toLowerCase()}`;
    const cached = this.#answers.get(key);
    if (cached !== undefined) return cached;

    // A chain with no RPC entry cannot be asked. `false` would say "EOA", which
    // is the answer that lets a payment through — so this reports "contract
    // here" instead, and the rail is refused rather than silently allowed.
    const url = this.#rpcUrls[chain];
    if (url === undefined) return true;

    try {
      const code = await this.#clientFor(chain, url).getCode({ address: getAddress(address) });
      const answer = code !== undefined && code !== "0x";
      this.#answers.set(key, answer);
      return answer;
    } catch (error) {
      throw new ProviderError(
        `Reading contract code on ${chain} failed: ${error instanceof Error ? error.message : String(error)}`,
        { chain, address },
        { cause: error, retryable: true },
      );
    }
  }

  #clientFor(chain: ChainId, url: string): PublicClient {
    const cached = this.#clients.get(chain);
    if (cached !== undefined) return cached;

    const client = createPublicClient({ chain: VIEM_CHAINS[chain], transport: http(url) });
    this.#clients.set(chain, client);
    return client;
  }
}

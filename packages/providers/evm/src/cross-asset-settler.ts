/**
 * EVM adapter for `CrossAssetSettler` (#211).
 *
 * The third component holding a key that can move funds, after
 * `EvmTreasuryExecutionPort` and `LocalX402Facilitator`. It moves what the
 * operator was just paid: a cross-asset x402 authorization sends the payer's
 * asset to the operator, and this swaps it into the merchant's and delivers it.
 *
 * The route comes from `SwapRouteSource`, which already produces exact-output
 * calldata with a recipient and an expected input — the same seam the contract
 * path uses, asked for a different recipient. The merchant is paid directly
 * rather than through `PaymentRouter`: the router pulls from `msg.sender`
 * through Permit2, and the payer here never sends a transaction at all.
 *
 * Two properties are worth stating because both were bought with incidents:
 *
 * - **`send` returns as soon as there is a hash.** Waiting for a receipt first
 *   would mean a crash in between loses the only pointer to a swap that has
 *   already executed, and a swap has no nonce to stop a second one — re-sending
 *   spends the operator's own balance and pays the merchant twice.
 * - **Every log is filtered by its own token contract.** On Arc one movement of
 *   USDC writes a `Transfer` on the native view as well as on the ERC-20 one,
 *   so summing every `Transfer` in a receipt counts the same money twice. This
 *   is the same fact that made every Arc settlement ambiguous in #255.
 *
 * The operator's key is now signed against from three places in two processes,
 * and each serialises only its own submissions. A nonce collision fails the
 * broadcast rather than moving anything, so it costs a payment rather than
 * money — but a shared submitter is the real answer and does not exist yet.
 */

import type { ChainId } from "@mayarin/chain";
import type { SwapRouteSource } from "@mayarin/execution";
import { ConfigurationError, type Money, money, ProviderError } from "@mayarin/shared";
import type { CrossAssetSettler, CrossAssetSwap, CrossAssetSwapRequest } from "@mayarin/x402";
import {
  type Account,
  type Address,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  type Hex,
  parseAbi,
} from "viem";
import { shortReason } from "./errors.ts";
import type { ChainClients } from "./treasury-executor.ts";

const erc20Abi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export interface EvmCrossAssetSettlerOptions {
  readonly clients: Readonly<Partial<Record<ChainId, ChainClients>>>;
  /** The key the authorization paid, and therefore the one holding the payer's asset. */
  readonly account: Account;
  readonly routes: SwapRouteSource;
  /** ERC-20 address per chain and asset, as `CHAIN_ASSETS` gives them. */
  readonly tokens: Readonly<Partial<Record<ChainId, Readonly<Record<string, string>>>>>;
  /** Confirmation depth per chain. A chain with no entry uses two. */
  readonly confirmations?: Readonly<Partial<Record<ChainId, number>>>;
}

export class EvmCrossAssetSettler implements CrossAssetSettler {
  readonly #options: EvmCrossAssetSettlerOptions;
  /** One in-flight submission per chain; see `EvmTreasuryExecutionPort` for why. */
  readonly #submissions = new Map<ChainId, Promise<unknown>>();

  constructor(options: EvmCrossAssetSettlerOptions) {
    this.#options = options;
  }

  async plan(request: CrossAssetSwapRequest): Promise<Money> {
    return (await this.#route(request)).expectedIn;
  }

  async send(request: CrossAssetSwapRequest): Promise<string> {
    const { account } = this.#options;
    const { publicClient } = this.#clientsFor(request.chain);
    const route = await this.#route(request);
    const router = getAddress(route.router);
    const token = this.#tokenFor(request.chain, request.held.asset);

    // The router has to be able to pull the payer's asset before the swap can
    // spend it, and an approval that is not mined yet is an approval the swap
    // does not have — so this one waits where the swap deliberately does not.
    const approved = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, router],
    });
    if (approved < request.held.amount) {
      const approval = await this.#broadcast(
        request.chain,
        token,
        encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [router, 2n ** 256n - 1n],
        }),
      );
      await publicClient.waitForTransactionReceipt({
        hash: approval,
        confirmations: this.#confirmations(request.chain),
      });
    }

    return this.#broadcast(request.chain, router, route.callData);
  }

  async confirm(transaction: string, request: CrossAssetSwapRequest): Promise<CrossAssetSwap> {
    const { account } = this.#options;
    const { publicClient } = this.#clientsFor(request.chain);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: transaction as Hex,
      confirmations: this.#confirmations(request.chain),
    });

    if (receipt.status !== "success") {
      throw new ProviderError(
        `The cross-asset swap ${transaction} reverted on ${request.chain}`,
        { transaction, chain: request.chain },
        { retryable: false },
      );
    }

    const payerToken = this.#tokenFor(request.chain, request.held.asset);
    const settlementToken = this.#tokenFor(request.chain, request.exactOut.asset);
    const recipient = getAddress(request.recipient);

    const spent = this.#sum(receipt.logs, payerToken, (from) => from === account.address);
    const delivered = this.#sum(receipt.logs, settlementToken, undefined, (to) => to === recipient);

    // The port's contract: a swap that did not deliver the invoice has not
    // settled the payment. Reporting the shortfall would let a caller record a
    // merchant as paid for an amount they did not receive.
    if (delivered !== request.exactOut.amount) {
      throw new ProviderError(
        `The cross-asset swap ${transaction} delivered ${delivered} of ${request.exactOut.asset}, not the invoiced ${request.exactOut.amount}`,
        { transaction, delivered: delivered.toString() },
        { retryable: false },
      );
    }
    // Cannot happen against a route bounded by `amountInMaximum`, and checked
    // anyway: the surplus is derived from this number, and a `spent` above what
    // the payer authorised would post a negative balance to their name.
    if (spent > request.held.amount) {
      throw new ProviderError(
        `The cross-asset swap ${transaction} spent ${spent} of ${request.held.asset}, more than the ${request.held.amount} authorised`,
        { transaction, spent: spent.toString() },
        { retryable: false },
      );
    }

    return {
      transaction,
      spent: money(spent, request.held.asset),
      delivered: money(delivered, request.exactOut.asset),
    };
  }

  /**
   * Routed again on every call, never cached from `plan`.
   *
   * A route commits to a fill and goes stale far faster than a price does, so
   * the one that bounded the payment is not the one that should execute it.
   */
  async #route(request: CrossAssetSwapRequest) {
    return this.#options.routes.route({
      payerAsset: request.held.asset,
      settlementAsset: request.exactOut.asset,
      exactOut: request.exactOut,
      maxIn: request.held,
      recipient: request.recipient,
      chain: request.chain,
    });
  }

  /**
   * Sums one token's transfers in a receipt.
   *
   * Filtered by the emitting contract before anything is decoded. On Arc a
   * single USDC movement emits a `Transfer` from the native view and another
   * from the ERC-20 view — the same money on two contracts — so a sum over
   * every `Transfer` in the receipt is double on that chain and correct
   * everywhere else, which is the worst way for it to be wrong.
   */
  #sum(
    logs: readonly { address: string; topics: readonly Hex[]; data: Hex }[],
    token: Address,
    from?: (address: Address) => boolean,
    to?: (address: Address) => boolean,
  ): bigint {
    let total = 0n;
    for (const log of logs) {
      if (getAddress(log.address) !== token) continue;
      let decoded: { eventName: string; args: unknown };
      try {
        decoded = decodeEventLog({
          abi: erc20Abi,
          data: log.data,
          topics: log.topics as [Hex, ...Hex[]],
        });
      } catch {
        // A log this token emitted that is not a `Transfer`; not an error.
        continue;
      }
      if (decoded.eventName !== "Transfer") continue;
      const args = decoded.args as { from: Address; to: Address; value: bigint };
      if (from !== undefined && !from(getAddress(args.from))) continue;
      if (to !== undefined && !to(getAddress(args.to))) continue;
      total += args.value;
    }
    return total;
  }

  async #broadcast(chain: ChainId, to: Address, data: Hex): Promise<Hex> {
    const { account } = this.#options;
    const { publicClient, walletClient } = this.#clientsFor(chain);

    const queued = this.#submissions.get(chain) ?? Promise.resolve();
    const result = queued.then(send, send);
    this.#submissions.set(
      chain,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;

    async function send(): Promise<Hex> {
      try {
        return await walletClient.sendTransaction({
          account,
          to,
          data,
          value: 0n,
          nonce: await publicClient.getTransactionCount({
            address: account.address,
            blockTag: "pending",
          }),
          chain: null,
        });
      } catch (error) {
        throw new ProviderError(
          `Broadcasting the cross-asset swap failed: ${shortReason(error)}`,
          { chain },
          { cause: error, retryable: true },
        );
      }
    }
  }

  #confirmations(chain: ChainId): number {
    return this.#options.confirmations?.[chain] ?? 2;
  }

  #clientsFor(chain: ChainId): ChainClients {
    const clients = this.#options.clients[chain];
    if (clients === undefined) {
      throw new ProviderError(
        `No RPC client for ${chain}; a cross-asset payment cannot be settled there`,
        { chain },
        { retryable: false },
      );
    }
    return clients;
  }

  #tokenFor(chain: ChainId, asset: string): Address {
    const address = this.#options.tokens[chain]?.[asset];
    if (address === undefined) {
      throw new ConfigurationError(`No ${asset} contract configured on ${chain}`, { chain, asset });
    }
    return getAddress(address);
  }
}

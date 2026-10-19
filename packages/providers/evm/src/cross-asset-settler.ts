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
 * The operator's key is signed against from three places in two processes; all
 * of them take their nonce from one shared `NonceSequencer`.
 */

import type { ChainId } from "@mayarin/chain";
import type { SwapRouteSource } from "@mayarin/execution";
import {
  ConfigurationError,
  type Money,
  money,
  type NonceSequencer,
  ProviderError,
} from "@mayarin/shared";
import type {
  CrossAssetSettler,
  CrossAssetSwap,
  CrossAssetSwapRequest,
  PayerSurplusRefund,
  PayerSurplusRefundRequest,
} from "@mayarin/x402";
import {
  type Account,
  type Address,
  decodeEventLog,
  decodeFunctionData,
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
  "function transfer(address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

/**
 * The two swap shapes this deployment encodes itself. A route naming any other
 * function is refused: calldata that cannot be read cannot be checked.
 */
const swapAbi = parseAbi([
  "function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn)",
  "function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
]);

export interface EvmCrossAssetSettlerOptions {
  /**
   * The only routers this settler will approve and call, per chain (SEC-17).
   *
   * The route source is a third-party API and the operator key holds the
   * payer's asset while it swaps, so the address that API returns is not
   * trusted: a route naming any other router is refused before anything is
   * approved or sent. A chain with no entry refuses every route.
   */
  readonly allowedRouters: Readonly<Partial<Record<ChainId, readonly string[]>>>;
  /** Shared by every submitter of the operator key; see `NonceSequencer`. */
  readonly nonces: NonceSequencer;
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
          // Exactly what this swap may consume, not a standing allowance.
          args: [router, request.held.amount],
        }),
      );
      await publicClient.waitForTransactionReceipt({
        hash: approval,
        confirmations: this.#confirmations(request.chain),
      });
    }

    return this.#broadcast(request.chain, router, route.callData, "cross-asset swap");
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

  async sendRefund(request: PayerSurplusRefundRequest): Promise<string> {
    const token = this.#tokenFor(request.chain, request.amount.asset);
    return this.#broadcast(
      request.chain,
      token,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [getAddress(request.recipient), request.amount.amount],
      }),
      "payer-surplus refund",
    );
  }

  async confirmRefund(
    transaction: string,
    request: PayerSurplusRefundRequest,
  ): Promise<PayerSurplusRefund> {
    const { account } = this.#options;
    const { publicClient } = this.#clientsFor(request.chain);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: transaction as Hex,
      confirmations: this.#confirmations(request.chain),
    });
    if (receipt.status !== "success") {
      throw new ProviderError(
        `The payer-surplus refund ${transaction} reverted on ${request.chain}`,
        { transaction, chain: request.chain },
        { retryable: false },
      );
    }

    const token = this.#tokenFor(request.chain, request.amount.asset);
    const recipient = getAddress(request.recipient);
    const returned = this.#sum(
      receipt.logs,
      token,
      (from) => from === account.address,
      (to) => to === recipient,
    );
    if (returned !== request.amount.amount) {
      throw new ProviderError(
        `The payer-surplus refund ${transaction} returned ${returned} of ${request.amount.asset}, not the owed ${request.amount.amount}`,
        { transaction, returned: returned.toString() },
        { retryable: false },
      );
    }
    return { transaction, amount: money(returned, request.amount.asset) };
  }

  /**
   * Routed again on every call, never cached from `plan`.
   *
   * A route commits to a fill and goes stale far faster than a price does, so
   * the one that bounded the payment is not the one that should execute it.
   */
  async #route(request: CrossAssetSwapRequest) {
    const route = await this.#options.routes.route({
      payerAsset: request.held.asset,
      settlementAsset: request.exactOut.asset,
      exactOut: request.exactOut,
      maxIn: request.held,
      recipient: request.recipient,
      chain: request.chain,
    });
    this.#assertAllowed(request.chain, route.router);
    this.#assertCallData(request, route.callData);
    return route;
  }

  /**
   * The route source is a third-party seam, so its calldata is read before the
   * operator key signs it (SEC-17): it must swap the held asset for the
   * settlement asset, pay the merchant exactly the invoice and spend no more
   * than the payer authorised.
   */
  #assertCallData(request: CrossAssetSwapRequest, callData: Hex): void {
    const held = this.#tokenFor(request.chain, request.held.asset);
    const settlement = this.#tokenFor(request.chain, request.exactOut.asset);
    const recipient = getAddress(request.recipient);

    let tokenIn: Address;
    let tokenOut: Address;
    let to: Address;
    let amountOut: bigint;
    let amountInMax: bigint;
    try {
      const call = decodeFunctionData({ abi: swapAbi, data: callData });
      if (call.functionName === "exactOutputSingle") {
        const [params] = call.args;
        ({ tokenIn, tokenOut, recipient: to, amountOut, amountInMaximum: amountInMax } = params);
      } else {
        const [out, inMax, path, recipientArg] = call.args;
        const first = path[0];
        const last = path[path.length - 1];
        if (first === undefined || last === undefined) throw new Error("empty path");
        [amountOut, amountInMax, tokenIn, tokenOut, to] = [out, inMax, first, last, recipientArg];
      }
    } catch {
      throw new ConfigurationError("The route calldata is not a swap this settler recognises", {
        chain: request.chain,
      });
    }

    const matches =
      getAddress(tokenIn) === held &&
      getAddress(tokenOut) === settlement &&
      getAddress(to) === recipient &&
      amountOut === request.exactOut.amount &&
      amountInMax <= request.held.amount;
    if (!matches) {
      throw new ConfigurationError(
        "The route calldata does not swap the held asset for the invoice to the merchant",
        { chain: request.chain },
      );
    }
  }

  #assertAllowed(chain: ChainId, router: string): void {
    const allowed = (this.#options.allowedRouters[chain] ?? []).map((address) =>
      address.toLowerCase(),
    );
    if (!allowed.includes(router.toLowerCase())) {
      throw new ConfigurationError(
        `The route names a router that is not on the ${chain} allowlist`,
        { chain, router },
      );
    }
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

  async #broadcast(
    chain: ChainId,
    to: Address,
    data: Hex,
    operation = "cross-asset swap",
  ): Promise<Hex> {
    const { account } = this.#options;
    const { publicClient, walletClient } = this.#clientsFor(chain);

    try {
      return await this.#options.nonces.broadcast(
        `${chain}:${account.address.toLowerCase()}`,
        () => publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
        (nonce) =>
          walletClient.sendTransaction({ account, to, data, value: 0n, nonce, chain: null }),
        { to, data, value: 0n },
      );
    } catch (error) {
      throw new ProviderError(
        `Broadcasting the ${operation} failed: ${shortReason(error)}`,
        { chain },
        { cause: error, retryable: true },
      );
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

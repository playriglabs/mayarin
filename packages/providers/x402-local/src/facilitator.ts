/**
 * The local facilitator: Mayarin broadcasts the payer's authorization itself.
 *
 * This is the second component in the system holding a key that can move funds,
 * after `EvmTreasuryExecutionPort`. It moves the *payer's* funds rather than
 * the treasury's, and only in the one direction their signature authorises —
 * `transferWithAuthorization` cannot change the amount or the recipient, so the
 * key here buys gas, not discretion. That is the whole reason `exact` is worth
 * implementing: the facilitator is a broadcaster, not a custodian.
 *
 * Two things it deliberately does not do:
 *
 * - It does not decide a payment has settled. `settle` returns what the chain
 *   told it, and `confirmSettlement` in `@mayarin/x402` reads the transaction
 *   back before anything advances. A local facilitator is not more trustworthy
 *   than a remote one just because it is ours; it is the same code path.
 * - It does not retry. A `transferWithAuthorization` that reverted has consumed
 *   nothing and can be sent again by the caller, but only after the caller has
 *   decided that is what it wants — an authorization is single-use, and a retry
 *   loop against a token that recorded the nonce burns gas for a guaranteed
 *   revert.
 */

import type { ChainId } from "@mayarin/chain";
import { caip2Of } from "@mayarin/chain";
import type { Clock } from "@mayarin/shared";
import { ProviderError } from "@mayarin/shared";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
  X402Facilitator,
} from "@mayarin/x402";
import { EXACT_SCHEME, eip3009PayloadOf } from "@mayarin/x402";
import type { Account, Address, Hex, PublicClient, WalletClient } from "viem";
import { eip3009Abi } from "./abi.ts";
import type { EvmX402Reader } from "./reader.ts";

export interface LocalX402FacilitatorOptions {
  readonly chain: ChainId;
  readonly reader: EvmX402Reader;
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient;
  /** The key that pays gas. It cannot redirect or resize a payment. */
  readonly account: Account;
  readonly clock: Clock;
  /** Blocks to wait before reporting a settlement. Default 1. */
  readonly confirmations?: number;
}

export class LocalX402Facilitator implements X402Facilitator {
  /**
   * One per chain, so the name says which.
   *
   * The registry refuses two facilitators sharing a name, because a payment
   * would then settle through whichever came first in an array. A constant
   * `"local"` made that refusal fire the moment a deployment served a second
   * chain — correctly, and for the wrong reason: they were distinct
   * facilitators wearing one label, not a duplicate.
   */
  readonly name: string;
  readonly #chain: ChainId;
  readonly #network: string;
  readonly #reader: EvmX402Reader;
  readonly #publicClient: PublicClient;
  readonly #walletClient: WalletClient;
  readonly #account: Account;
  readonly #clock: Clock;
  readonly #confirmations: number;

  /**
   * Serialises broadcasts from the operator account.
   *
   * The same constraint `EvmTreasuryExecutionPort` documents, and worse here.
   * A nonce belongs to the key, not to a payment: two settlements racing both
   * read the pending nonce, both get `N`, and the second is rejected
   * `replacement transaction underpriced` — not because anything is wrong with
   * it, but because it bid the same gas for a slot already taken. The treasury
   * executor meets this once per payment; an x402 rail meets it once per API
   * call, which is the volume the whole design is for.
   *
   * A promise chain is enough, and the critical section is the broadcast alone:
   * once a transaction is in the mempool the next `pending` read counts it, so
   * holding the lock through the receipt would serialise confirmations for
   * nothing.
   */
  #broadcasts: Promise<unknown> = Promise.resolve();

  constructor(options: LocalX402FacilitatorOptions) {
    this.#chain = options.chain;
    this.name = `local:${options.chain}`;
    this.#network = caip2Of(options.chain);
    this.#reader = options.reader;
    this.#publicClient = options.publicClient;
    this.#walletClient = options.walletClient;
    this.#account = options.account;
    this.#clock = options.clock;
    this.#confirmations = options.confirmations ?? 1;
  }

  supports(requirements: PaymentRequirements): boolean {
    return requirements.network === this.#network && requirements.scheme === EXACT_SCHEME;
  }

  async verify(
    payment: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const payer = eip3009PayloadOf(payment).authorization.from;
    const invalidReason = await this.#reader.check(payment, requirements, this.#clock.now());
    return invalidReason === undefined
      ? { isValid: true, payer }
      : { isValid: false, invalidReason, payer };
  }

  /**
   * Broadcast, wait, report.
   *
   * Verification runs again here rather than being assumed from an earlier
   * call. The gap between verifying and settling is a gap in which the payer's
   * balance can move, the nonce can be spent by another broadcaster, and the
   * authorization can expire — and the cost of finding out from a revert
   * instead is a wasted transaction fee on every one of those.
   */
  async settle(
    payment: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const payer = eip3009PayloadOf(payment).authorization.from;

    const invalidReason = await this.#reader.check(payment, requirements, this.#clock.now());
    if (invalidReason !== undefined) {
      return {
        success: false,
        errorReason: invalidReason,
        transaction: "",
        network: this.#network,
        payer,
      };
    }

    let hash: Hex;
    try {
      hash = await this.#broadcast(payment, requirements);
    } catch (error) {
      // Reported rather than thrown, because a failed settlement is a protocol
      // answer the payer's client can read — `SettleResponse.success` is false
      // and `errorReason` says why. `confirmSettlement` turns it into a
      // non-retryable error on our side.
      return {
        success: false,
        errorReason: error instanceof Error ? error.message : "broadcast failed",
        transaction: "",
        network: this.#network,
        payer,
      };
    }

    const receipt = await this.#publicClient.waitForTransactionReceipt({
      hash,
      confirmations: this.#confirmations,
    });

    // A mined revert is a settlement that did not happen, and it has a hash.
    // Returning success here would hand `confirmSettlement` a real transaction
    // to find, which it would then reject for moving nothing — a slower, more
    // confusing route to the same answer.
    if (receipt.status !== "success") {
      return {
        success: false,
        errorReason: "transaction reverted",
        transaction: hash,
        network: this.#network,
        payer,
      };
    }

    return {
      success: true,
      transaction: hash,
      network: this.#network,
      payer,
      amount: requirements.amount,
    };
  }

  async #broadcast(payment: PaymentPayload, requirements: PaymentRequirements): Promise<Hex> {
    const send = async (): Promise<Hex> =>
      this.#walletClient.writeContract({
        chain: null,
        account: this.#account,
        address: requirements.asset as Address,
        abi: eip3009Abi,
        functionName: "transferWithAuthorization",
        args: this.#reader.callArgsFor(payment),
      });

    const queued = this.#broadcasts.then(send, send);
    // The chain continues whether or not this broadcast succeeded, so the next
    // caller must not inherit this one's rejection.
    this.#broadcasts = queued.catch(() => undefined);
    try {
      return await queued;
    } catch (error) {
      throw new ProviderError(
        `x402 settlement broadcast failed on ${this.#chain}`,
        { chain: this.#chain },
        { cause: error, retryable: false },
      );
    }
  }
}

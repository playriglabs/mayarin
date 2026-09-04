/**
 * Treasury execution — moving a matched deposit into `PaymentRouter` (RFC #69).
 *
 * The deposit path detects the payer's asset and stops. The contract executes
 * atomically, but only when someone calls it, and on the deposit path nobody
 * does: the payer sent a plain transfer and has no further part to play. This
 * is the missing trigger.
 *
 * ```
 * ASSET_RECEIVED (deposit-match)
 *   → sweep the deposit forwarder to the operator
 *   → assemble payEth / payERC20 from the persisted signed order
 *   → submit, and measure what actually came out
 *   → post the swap and the gas → SETTLING
 * ```
 *
 * The order is **reused, never re-signed**. It was signed at `PRICE_LOCKED` and
 * persisted with the transaction; re-signing on a retry would issue a second
 * order for one payment, and the only thing stopping both from executing is
 * that the contract consumes `intentId` — a race, not a design.
 *
 * Effects are injected. This file decides *what* happens and in what order;
 * `TreasuryExecutionPort` is the only thing that touches a key or a chain, and
 * it lives outside `core` like every other adapter.
 */

import type { ChainId } from "@mayarin/chain";
import type { LedgerService } from "@mayarin/ledger";
import { type AssetCode, isMayarinError, MayarinError, type Money } from "@mayarin/shared";
import type { ContractOrder } from "./contract-path.ts";
import { gasPosting, swapPosting } from "./postings.ts";
import type { ClearingDeposit, ClearingTransaction } from "./types.ts";

/** Raised when the swap could not meet `minOut` within the attempt bound. */
export class ExecutionExhaustedError extends MayarinError {
  readonly code = "EXECUTION_EXHAUSTED";
  readonly httpStatus = 502;
  /**
   * Terminal on purpose. Every attempt already refetched a route, so retrying
   * further is a bet that the price comes back — and while it does not, Mayarin
   * holds the payer's asset against an obligation it cannot discharge.
   */
  override readonly retryable = false;
}

export interface SweepRequest {
  readonly clearingTransactionId: string;
  readonly chain: ChainId;
  /**
   * The deposit address, which is what the clearing transaction knows.
   *
   * Not the derivation index, even though the forwarder's salt is derived from
   * it: the index lives on the chain layer's `DepositAddress` and in the
   * database, not on `ClearingDeposit`. The adapter resolves address → index,
   * which keeps the lookup where the data already is and needs no migration to
   * copy it onto a second aggregate.
   */
  readonly depositAddress: string;
  /** Native vs ERC-20 is a property of the asset; the adapter maps it to a token address. */
  readonly asset: AssetCode;
}

export interface ExecuteRequest {
  readonly clearingTransactionId: string;
  readonly chain: ChainId;
  /** The persisted signed order, verbatim. Never rebuilt, never re-signed. */
  readonly order: ContractOrder;
  /** What the payer deposited, now held by the operator. */
  readonly inputAmount: Money;
  /** Which attempt this is, so the adapter refetches a route per attempt. */
  readonly attempt: number;
}

export interface ExecutionResult {
  readonly txHash: string;
  /** Settlement asset actually delivered, measured on-chain — not the quote. */
  readonly output: Money;
  /**
   * Native gas the operator paid, when the chain's own currency is one this
   * deployment can name.
   *
   * Optional because a figure in the wrong asset is worse than no figure: it
   * would be posted to the ledger, and a gas expense denominated in an asset
   * the chain does not have is a number that balances and means nothing.
   */
  readonly gasCost?: Money;
}

/**
 * The only seam that holds a key.
 *
 * Deliberately separate from `ChainClient`, which is read-only so that a bug in
 * the watch path has nothing to move funds with. That property is worth keeping;
 * this port is where it is knowingly given up, for one caller.
 */
export interface TreasuryExecutionPort {
  sweep(request: SweepRequest): Promise<void>;
  execute(request: ExecuteRequest): Promise<ExecutionResult>;
}

export interface TreasuryExecutorOptions {
  readonly port: TreasuryExecutionPort;
  readonly ledger: LedgerService;
  /**
   * How many times to submit before giving up.
   *
   * A `minOut` miss costs gas and moves nothing — the router hard-reverts — so
   * a retry is cheap and often just needs a fresher route. What it cannot do is
   * run forever: past the bound the price has moved, not wobbled.
   */
  readonly maxAttempts?: number;
}

export interface TreasuryExecution {
  readonly txHash: string;
  readonly output: Money;
  readonly gasCost?: Money;
}

export class TreasuryExecutor {
  readonly #port: TreasuryExecutionPort;
  readonly #ledger: LedgerService;
  readonly #maxAttempts: number;

  constructor(options: TreasuryExecutorOptions) {
    this.#port = options.port;
    this.#ledger = options.ledger;
    this.#maxAttempts = options.maxAttempts ?? 3;
  }

  /**
   * Executes one matched deposit.
   *
   * Idempotent on two levels, both of which already existed: the postings are
   * keyed `${transactionId}:SWAPPED` and `:GAS`, and the contract consumes
   * `intentId` on success. A double submission is rejected on-chain with
   * `AlreadyConsumed` rather than by this function happening to run once.
   */
  async execute(transaction: ClearingTransaction): Promise<TreasuryExecution> {
    const deposit = transaction.deposit;
    const order = transaction.contract;

    if (deposit === undefined) {
      throw new ExecutionExhaustedError(
        `Clearing transaction ${transaction.id} has no deposit to execute`,
        { id: transaction.id },
      );
    }

    if (order === undefined) {
      throw new ExecutionExhaustedError(
        `Clearing transaction ${transaction.id} has no signed order to execute`,
        { id: transaction.id },
      );
    }

    // Sweep first and unconditionally. It is idempotent on-chain — an already
    // deployed forwarder with a zero balance is a no-op, not a revert — so a
    // resumed step repeats it harmlessly, which is what makes the whole step
    // resumable rather than needing a "did I already sweep" flag.
    await this.#port.sweep({
      clearingTransactionId: transaction.id,
      chain: deposit.chain,
      depositAddress: deposit.address,
      asset: deposit.asset,
    });

    const result = await this.#submitWithRetries(transaction, deposit, order.order);

    // Post what actually happened, not what was quoted. The gap between the two
    // is the FX result, and it is Mayarin's — see `swapPosting`.
    await this.#ledger.post(swapPosting(transaction, result.output));
    // An unmeasurable gas cost is left out of the books rather than guessed at.
    if (result.gasCost !== undefined) {
      await this.#ledger.post(gasPosting(transaction, result.gasCost));
    }

    return result;
  }

  async #submitWithRetries(
    transaction: ClearingTransaction,
    deposit: ClearingDeposit,
    order: ContractOrder,
  ): Promise<ExecutionResult> {
    const failures: string[] = [];

    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      try {
        return await this.#port.execute({
          clearingTransactionId: transaction.id,
          chain: deposit.chain,
          order,
          inputAmount: deposit.amount,
          attempt,
        });
      } catch (error) {
        // Only a retryable failure earns another attempt. A rejected signature
        // or a consumed intent will fail identically every time, and retrying
        // it just delays the point at which someone is told.
        if (!isRetryable(error)) throw error;
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }

    throw new ExecutionExhaustedError(
      `Execution for ${transaction.id} did not settle in ${this.#maxAttempts} attempts`,
      { id: transaction.id, attempts: this.#maxAttempts, failures },
    );
  }
}

function isRetryable(error: unknown): boolean {
  return isMayarinError(error) && error.retryable;
}

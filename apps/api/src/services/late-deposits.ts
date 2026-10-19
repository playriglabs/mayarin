/**
 * Funds that reached a deposit address after its payment expired.
 *
 * The watcher keeps recording a deposit for 24 hours after a payment goes
 * terminal, but only funds a payment still waiting for one. A payer who paid
 * just before the deadline, or whose deposit the watcher saw late, is left with
 * money at an address and a payment marked failed. Nothing refunds it or settles
 * it, so this finds it.
 *
 * It reports, and it accepts on a person's say-so. Accepting settles the payment
 * at the price that was locked, which may have moved since; that is a judgement
 * about the price and the payer, not something to automate. The alternative is a
 * refund, which is a manual operation (see the runbook).
 */

import type { DepositRepository } from "@mayarin/chain";
import type { ClearingEngine, ClearingTransaction } from "@mayarin/clearing";
import { type Clock, type Money, NotFoundError, ValidationError } from "@mayarin/shared";

export interface LateDeposit {
  readonly paymentIntentId: string;
  readonly clearingTransactionId: string;
  readonly chain: string;
  readonly address: string;
  readonly required: Money;
  /** Confirmed at the address; at least `required`. */
  readonly received: Money;
  readonly expiredAt: Date;
}

export interface LateDepositServiceOptions {
  readonly engine: Pick<ClearingEngine, "listExpired" | "acceptLateFunds" | "getById">;
  readonly deposits: Pick<DepositRepository, "confirmedTotal">;
  readonly clock: Clock;
  /** How far back an expiry is still looked at: the watcher's retention. */
  readonly windowMs: number;
}

export class LateDepositService {
  readonly #engine: LateDepositServiceOptions["engine"];
  readonly #deposits: LateDepositServiceOptions["deposits"];
  readonly #clock: Clock;
  readonly #windowMs: number;

  constructor(options: LateDepositServiceOptions) {
    this.#engine = options.engine;
    this.#deposits = options.deposits;
    this.#clock = options.clock;
    this.#windowMs = options.windowMs;
  }

  /** Expired payments with a confirmed deposit that covers what was asked. */
  async list(): Promise<readonly LateDeposit[]> {
    const since = new Date(this.#clock.now().getTime() - this.#windowMs);
    const found: LateDeposit[] = [];
    for (const transaction of await this.#engine.listExpired(since)) {
      const late = await this.#lateFunds(transaction);
      if (late !== undefined) found.push(late);
    }
    return found;
  }

  /** Reopens one, after checking again that the funds are there. */
  async accept(clearingTransactionId: string): Promise<ClearingTransaction> {
    const transaction = await this.#engine.getById(clearingTransactionId).catch(() => undefined);
    if (transaction === undefined) {
      throw new NotFoundError("No such payment", { id: clearingTransactionId });
    }
    if ((await this.#lateFunds(transaction)) === undefined) {
      throw new ValidationError("No confirmed deposit covers this payment", {
        id: clearingTransactionId,
      });
    }
    return (await this.#engine.acceptLateFunds(clearingTransactionId)).transaction;
  }

  async #lateFunds(transaction: ClearingTransaction): Promise<LateDeposit | undefined> {
    const { deposit, failure } = transaction;
    if (deposit === undefined || failure === undefined) return undefined;
    const received = await this.#deposits.confirmedTotal(
      deposit.chain,
      deposit.address,
      deposit.amount.asset,
    );
    if (received.amount < deposit.amount.amount) return undefined;
    return {
      paymentIntentId: transaction.paymentIntentId,
      clearingTransactionId: transaction.id,
      chain: deposit.chain,
      address: deposit.address,
      required: deposit.amount,
      received,
      expiredAt: failure.at,
    };
  }
}

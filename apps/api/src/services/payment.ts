/**
 * Payment application service.
 *
 * Orchestrates the two routes that span more than one core service: confirming
 * an intent (intent → engine) and reading a payment (intent → engine → chain
 * deposits). Single-core routes stay thin and do not need an app service.
 *
 * No Hono, no DTO shaping here — the route maps the returned domain types to the
 * wire DTO.
 */

import type { BlockRef, ChainId, Deposit } from "@mayarin/chain";
import type { ClearingEngine, ClearingEvent, ClearingTransaction } from "@mayarin/clearing";
import type { LedgerService } from "@mayarin/ledger";
import type { PaymentIntent, PaymentIntentService } from "@mayarin/payment-intent";
import type { ChainConfig } from "../config.ts";

export interface ConfirmResult {
  readonly intent: PaymentIntent;
  readonly transaction: ClearingTransaction;
  readonly events: readonly ClearingEvent[];
}

export interface DepositView {
  readonly deposits: readonly Deposit[];
  readonly headNumber: bigint | undefined;
  readonly requiredConfirmations: number;
}

export interface PaymentView {
  readonly intent: PaymentIntent;
  readonly transaction: ClearingTransaction | null;
  readonly events: readonly ClearingEvent[];
  readonly deposit: DepositView | null;
}

export interface PaymentAppServiceOptions {
  readonly intents: PaymentIntentService;
  readonly engine: ClearingEngine;
  readonly ledger: LedgerService;
  /** Present only when the chain layer is enabled. */
  readonly deposits?: PaymentDepositReader;
  /** Current head of a chain, for rendering confirmation counts. */
  readonly chainHead?: (chain: ChainId) => Promise<BlockRef>;
  readonly chainConfig?: ChainConfig;
}

/** Reads the payer's side of a payment. */
export interface PaymentDepositReader {
  listByAddress(chain: ChainId, address: string): Promise<readonly Deposit[]>;
}

export class PaymentAppService {
  readonly #intents: PaymentIntentService;
  readonly #engine: ClearingEngine;
  readonly #deposits?: PaymentDepositReader;
  readonly #chainHead?: (chain: ChainId) => Promise<BlockRef>;
  readonly #chainConfig?: ChainConfig;

  constructor(options: PaymentAppServiceOptions) {
    this.#intents = options.intents;
    this.#engine = options.engine;
    // `exactOptionalPropertyTypes` forbids assigning `undefined` to an optional
    // field, so each edge dependency is set only when it is present.
    if (options.deposits !== undefined) this.#deposits = options.deposits;
    if (options.chainHead !== undefined) this.#chainHead = options.chainHead;
    if (options.chainConfig !== undefined) this.#chainConfig = options.chainConfig;
  }

  /**
   * Confirms an intent and starts clearing. Safe to retry: confirming an intent
   * that is already clearing returns its current position rather than starting a
   * second payment.
   */
  async confirm(intentId: string): Promise<ConfirmResult> {
    const intent = await this.#intents.confirm(intentId);
    const transaction = await this.#engine.start(intent);
    const [current, events] = await Promise.all([
      this.#intents.getById(intent.id),
      this.#engine.history(transaction.id),
    ]);
    return { intent: current, transaction, events };
  }

  /**
   * One view of a payment: what was owed (the intent), how far along paying it
   * is (the clearing transaction), and how it got there (the timeline). Accepts
   * either the intent id or the clearing transaction id, since callers hold
   * whichever they were handed.
   */
  async getPayment(id: string): Promise<PaymentView> {
    if (id.startsWith("clr_")) {
      const transaction = await this.#engine.getById(id);
      const [intent, events] = await Promise.all([
        this.#intents.getById(transaction.paymentIntentId),
        this.#engine.history(transaction.id),
      ]);
      return { intent, transaction, events, deposit: await this.depositView(transaction) };
    }

    const intent = await this.#intents.getById(id);
    const transaction = await this.#engine.findByPaymentIntentId(intent.id);
    const events = transaction === null ? [] : await this.#engine.history(transaction.id);
    return { intent, transaction, events, deposit: await this.depositView(transaction) };
  }

  /**
   * Reads the payer's side of a payment, or null when this deployment has no
   * chain layer. Confirmations are display-only, so an unreachable RPC renders
   * them as zero rather than failing the whole read.
   */
  async depositView(transaction: ClearingTransaction | null): Promise<DepositView | null> {
    const deposit = transaction?.deposit;
    if (transaction === null || deposit === undefined || this.#deposits === undefined) return null;
    if (this.#chainConfig === undefined) return null;

    const deposits = await this.#deposits.listByAddress(deposit.chain, deposit.address);
    const head = await this.#chainHead?.(deposit.chain).catch(() => undefined);
    return {
      deposits,
      headNumber: head?.number,
      requiredConfirmations: this.#chainConfig.confirmations[deposit.chain],
    };
  }
}

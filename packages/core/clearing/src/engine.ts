/**
 * Clearing engine.
 *
 * Every payment passes through here. The engine advances a transaction one
 * state at a time, persisting after each step, so a crash leaves a durable
 * position to resume from rather than a half-finished payment.
 *
 * Three properties hold at every step:
 *
 * - **Idempotent** — steps are keyed by `${transactionId}:${state}`, so ledger
 *   postings and provider calls can be replayed without duplicating value.
 * - **Resumable** — the persisted state is the only input a step needs; nothing
 *   lives in memory between steps.
 * - **Auditable** — every transition appends an event alongside the state
 *   change.
 *
 * Ordering within a step is deliberate: side effects (ledger posting, provider
 * call) happen *before* the state is persisted. Both are idempotent, so a crash
 * in between means the resumed step repeats a no-op and then records the state.
 * The reverse order could record a settlement that never happened.
 */

import type { DepositAddressDeriver, DepositAddressRepository } from "@mayarin/chain";
import type { LedgerService } from "@mayarin/ledger";
import type { PaymentIntent, PaymentIntentService } from "@mayarin/payment-intent";
import type {
  SettlementAdapterRegistry,
  SettlementRequest,
  WebhookContext,
} from "@mayarin/settlement";
import {
  type Clock,
  ConfigurationError,
  convert,
  type DomainEvent,
  type EventPublisher,
  InvalidStateTransitionError,
  isMayarinError,
  isPositive,
  NotFoundError,
  noopEventPublisher,
  QuoteExpiredError,
  serializeMoney,
  subtract,
  ValidationError,
} from "@mayarin/shared";
import type { ContractPaymentPlanner } from "./contract-path.ts";
import type { FeePolicy } from "./fees.ts";
import {
  assetReceivedPosting,
  clearingPosting,
  internalSettledPosting,
  settledPosting,
} from "./postings.ts";
import { lockRate, type RateProvider } from "./rate.ts";
import type { ClearingRepository } from "./repository.ts";
import { isTerminal } from "./state-machine.ts";
import {
  createClearingTransaction,
  failTransaction,
  type TransitionResult,
  transition,
} from "./transaction.ts";
import type { ClearingDeposit, ClearingEvent, ClearingTransaction } from "./types.ts";

export interface ClearingEngineOptions {
  readonly repository: ClearingRepository;
  readonly intents: PaymentIntentService;
  readonly ledger: LedgerService;
  readonly adapters: SettlementAdapterRegistry;
  readonly rates: RateProvider;
  readonly fees: FeePolicy;
  /**
   * Allocates a per-payment deposit address. Absent for a deployment with no
   * chain layer, in which case an intent naming a rail is rejected rather than
   * silently cleared without an address.
   */
  readonly depositAddresses?: DepositAddressRepository;
  readonly depositDeriver?: DepositAddressDeriver;
  /**
   * Prices, locks and signs the on-chain-contract path (#61). Absent for a
   * deployment without the contract layer, in which case a contract-path
   * intent is refused rather than silently cleared without a signed order.
   */
  readonly contractPlanner?: ContractPaymentPlanner;
  /**
   * How long past the lock deadline the engine keeps waiting for a
   * `PaymentCompleted` signal before failing with `QUOTE_EXPIRED`. Covers
   * indexing lag: the contract enforces the deadline on-chain, so a payment
   * included at the deadline can still signal a few seconds later.
   */
  readonly contractExpiryGraceSeconds?: number;
  readonly clock: Clock;
  readonly events?: EventPublisher;
  /**
   * Treats a payment as funded the moment it reaches `PAYMENT_PENDING`.
   *
   * Stand-in for the wallet watcher that confirms a deposit-match payment's
   * asset arrived. Deposit-matching is the fallback execution path; Phase 3's
   * on-chain-contract path funds atomically and does not wait here. With this
   * off, something must call `recordAssetReceived`.
   */
  readonly autoConfirmAssetReceipt?: boolean;
}

/** Outcome of asking the engine to make progress. */
export interface ClearingProgress {
  readonly transaction: ClearingTransaction;
  /** True when the engine stopped because it is waiting on the outside world. */
  readonly waiting: boolean;
}

export class ClearingEngine {
  readonly #repository: ClearingRepository;
  readonly #intents: PaymentIntentService;
  readonly #ledger: LedgerService;
  readonly #adapters: SettlementAdapterRegistry;
  readonly #rates: RateProvider;
  readonly #fees: FeePolicy;
  readonly #depositAddresses: DepositAddressRepository | undefined;
  readonly #depositDeriver: DepositAddressDeriver | undefined;
  readonly #contractPlanner: ContractPaymentPlanner | undefined;
  readonly #contractExpiryGraceSeconds: number;
  readonly #clock: Clock;
  readonly #events: EventPublisher;
  readonly #autoConfirmAssetReceipt: boolean;

  constructor(options: ClearingEngineOptions) {
    this.#repository = options.repository;
    this.#intents = options.intents;
    this.#ledger = options.ledger;
    this.#adapters = options.adapters;
    this.#rates = options.rates;
    this.#fees = options.fees;
    this.#depositAddresses = options.depositAddresses;
    this.#depositDeriver = options.depositDeriver;
    this.#contractPlanner = options.contractPlanner;
    this.#contractExpiryGraceSeconds = options.contractExpiryGraceSeconds ?? 60;
    this.#clock = options.clock;
    this.#events = options.events ?? noopEventPublisher;
    this.#autoConfirmAssetReceipt = options.autoConfirmAssetReceipt ?? false;
  }

  /**
   * Begins clearing a confirmed intent, or picks up where an earlier attempt
   * left off. Safe to call repeatedly: one clearing transaction per intent.
   */
  async start(intent: PaymentIntent): Promise<ClearingTransaction> {
    const existing = await this.#repository.findByPaymentIntentId(intent.id);
    if (existing !== null) return (await this.#advance(existing)).transaction;

    if (intent.status !== "CONFIRMED") {
      throw new ValidationError(
        `Payment intent ${intent.id} must be CONFIRMED before clearing, is ${intent.status}`,
        { id: intent.id, status: intent.status },
      );
    }

    const { transaction, event } = createClearingTransaction(intent, this.#clock.now());
    await this.#repository.insert(transaction, [event]);
    await this.#publish([event]);
    await this.#intents.markProcessing(intent, transaction.id);

    return (await this.#advance(transaction)).transaction;
  }

  async getById(id: string): Promise<ClearingTransaction> {
    const transaction = await this.#repository.findById(id);
    if (transaction === null) {
      throw new NotFoundError(`Clearing transaction ${id} not found`, { id });
    }
    return transaction;
  }

  async findByPaymentIntentId(paymentIntentId: string): Promise<ClearingTransaction | null> {
    return this.#repository.findByPaymentIntentId(paymentIntentId);
  }

  async history(id: string): Promise<ClearingEvent[]> {
    return this.#repository.listEvents(id);
  }

  /** Drives a transaction as far forward as it can go right now. */
  async resume(id: string): Promise<ClearingProgress> {
    return this.#advance(await this.getById(id));
  }

  /** Resumes every transaction left mid-flight. Drives recovery after a restart. */
  async resumeStuck(limit = 100): Promise<ClearingProgress[]> {
    const stuck = await this.#repository.listResumable(limit);
    const results: ClearingProgress[] = [];
    for (const transaction of stuck) {
      results.push(await this.#advance(transaction));
    }
    return results;
  }

  /**
   * Records that the payer's asset has arrived.
   *
   * The seam Phase 2's wallet watcher plugs into; until then it is driven by
   * `autoConfirmAssetReceipt` or called directly.
   */
  async recordAssetReceived(id: string): Promise<ClearingProgress> {
    const transaction = await this.getById(id);
    if (transaction.state !== "PAYMENT_PENDING") {
      // Already past this point: nothing to record, just keep going.
      return this.#advance(transaction);
    }
    return this.#advance(transaction, { assetReceived: true });
  }

  /**
   * Records that the contract settled this payment on-chain (#61).
   *
   * The seam the indexer (#8) calls when it ingests `PaymentCompleted`.
   * Unlike a webhook, the signal is authoritative: the indexer read the
   * event from the chain itself. A late signal still settles — the
   * contract's own deadline already bounded when the payment could execute,
   * and the expiry grace covers the indexing lag.
   */
  async recordPaymentCompleted(
    id: string,
    completion: { readonly txHash: string },
  ): Promise<ClearingProgress> {
    const transaction = await this.getById(id);
    if (transaction.executionPath !== "on-chain-contract") {
      throw new ValidationError(`Clearing transaction ${id} is not on the on-chain-contract path`, {
        id,
        executionPath: transaction.executionPath,
      });
    }
    if (transaction.state !== "PAYMENT_PENDING") {
      // Already past this point: nothing to record, just keep going.
      return this.#advance(transaction);
    }
    return this.#advance(transaction, { assetReceived: true, contractTxHash: completion.txHash });
  }

  /**
   * Handles an inbound provider webhook.
   *
   * The webhook is treated as a *signal*, not as truth: it wakes the engine,
   * which then asks the adapter for the authoritative status. That way a
   * spoofed or replayed webhook cannot settle a payment on its own.
   */
  async handleSettlementWebhook(
    provider: string,
    context: WebhookContext,
  ): Promise<ClearingProgress | null> {
    const adapter = this.#adapters.get(provider);
    const event = await adapter.webhook(context);
    if (event === null) return null;

    const transaction = await this.#repository.findByProviderReference(
      provider,
      event.providerReference,
    );
    if (transaction === null) return null;

    return this.#advance(transaction);
  }

  /** Fails a transaction and its intent. Terminal. */
  async fail(id: string, reason: string, code = "CLEARING_FAILED"): Promise<ClearingTransaction> {
    const transaction = await this.getById(id);
    if (isTerminal(transaction)) return transaction;
    return this.#fail(transaction, reason, code);
  }

  // --- Stepping ------------------------------------------------------------

  async #advance(
    start: ClearingTransaction,
    signals: { assetReceived?: boolean; contractTxHash?: string } = {},
  ): Promise<ClearingProgress> {
    let current = start;

    while (!isTerminal(current)) {
      let stepped: ClearingTransaction | null;

      try {
        stepped = await this.#step(current, signals);
      } catch (error) {
        // Retryable failures leave the transaction where it is so a later retry
        // — or `resumeStuck` — can pick it up from the same state.
        if (isMayarinError(error) && error.retryable) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        const code = isMayarinError(error) ? error.code : "CLEARING_FAILED";
        return { transaction: await this.#fail(current, reason, code), waiting: false };
      }

      if (stepped === null) return { transaction: current, waiting: true };
      current = stepped;
    }

    return { transaction: current, waiting: false };
  }

  /**
   * Executes exactly one state's work.
   *
   * Returns the next transaction, or `null` when the engine must wait for the
   * outside world (funds to arrive, a provider to confirm).
   */
  async #step(
    transaction: ClearingTransaction,
    signals: { assetReceived?: boolean; contractTxHash?: string },
  ): Promise<ClearingTransaction | null> {
    switch (transaction.state) {
      case "CREATED":
        return this.#apply(
          transition(
            transaction,
            "QR_PARSED",
            this.#clock.now(),
            {},
            {
              merchantId: transaction.merchant.id,
            },
          ),
        );

      case "QR_PARSED":
        return this.#lockPrice(transaction);

      case "PRICE_LOCKED":
        return this.#apply(transition(transaction, "PAYMENT_PENDING", this.#clock.now()));

      case "PAYMENT_PENDING": {
        if (transaction.executionPath === "on-chain-contract") {
          // The contract path funds atomically on-chain, so auto-confirm
          // never applies here: only a recorded `PaymentCompleted` advances.
          if (signals.assetReceived !== true) {
            this.#assertContractNotExpired(transaction);
            return null;
          }
          const contract = requireContract(transaction);
          await this.#ledger.post(assetReceivedPosting(transaction));
          const txHash = signals.contractTxHash;
          return this.#apply(
            transition(
              transaction,
              "ASSET_RECEIVED",
              this.#clock.now(),
              { contract: { ...contract, ...(txHash === undefined ? {} : { txHash }) } },
              {
                settlementAmount: serializeMoney(requireAmount(transaction, "settlementAmount")),
                ...(txHash === undefined ? {} : { txHash }),
              },
            ),
          );
        }

        if (!this.#autoConfirmAssetReceipt && signals.assetReceived !== true) return null;
        await this.#ledger.post(assetReceivedPosting(transaction));
        return this.#apply(
          transition(
            transaction,
            "ASSET_RECEIVED",
            this.#clock.now(),
            {},
            {
              settlementAmount: serializeMoney(requireAmount(transaction, "settlementAmount")),
            },
          ),
        );
      }

      case "ASSET_RECEIVED": {
        await this.#ledger.post(clearingPosting(transaction));
        return this.#apply(transition(transaction, "CLEARING", this.#clock.now()));
      }

      case "CLEARING":
        return transaction.executionPath === "on-chain-contract"
          ? this.#settleContract(transaction)
          : this.#settle(transaction);

      case "SETTLING":
        return transaction.executionPath === "on-chain-contract"
          ? this.#confirmContract(transaction)
          : this.#confirmSettlement(transaction);

      case "SETTLED": {
        const intent = await this.#intents.getById(transaction.paymentIntentId);
        await this.#intents.markCompleted(intent);
        return this.#apply(transition(transaction, "SUCCESS", this.#clock.now()));
      }

      case "SUCCESS":
      case "FAILED":
        return null;
    }
  }

  /** Quotes and freezes the settlement amount, fee and net payout. */
  async #lockPrice(transaction: ClearingTransaction): Promise<ClearingTransaction> {
    if (transaction.executionPath === "on-chain-contract") {
      return this.#lockContract(transaction);
    }
    const quote = await this.#rates.quote(
      transaction.sourceAmount.asset,
      transaction.settlementAsset,
      transaction.sourceAmount,
    );

    const now = this.#clock.now();
    const settlementAmount = convert(
      transaction.sourceAmount,
      transaction.settlementAsset,
      quote.minorUnitsPerWholeUnit,
    );
    const fee = this.#fees.feeFor(settlementAmount, {
      merchantId: transaction.merchant.id,
      provider: transaction.provider,
    });
    const netAmount = subtract(settlementAmount, fee);

    if (!isPositive(netAmount)) {
      throw new ValidationError(
        "Fee consumes the entire settlement amount; nothing would reach the merchant",
        {
          settlementAmount: settlementAmount.amount.toString(),
          fee: fee.amount.toString(),
          asset: settlementAmount.asset,
        },
      );
    }

    const deposit = await this.#lockDeposit(transaction, now);

    return this.#apply(
      transition(
        transaction,
        "PRICE_LOCKED",
        now,
        {
          rate: lockRate(quote, now),
          settlementAmount,
          fee,
          netAmount,
          ...(deposit === undefined ? {} : { deposit }),
        },
        {
          rate: quote.minorUnitsPerWholeUnit.toString(),
          rateSource: quote.source,
          settlementAmount: serializeMoney(settlementAmount),
          fee: serializeMoney(fee),
          netAmount: serializeMoney(netAmount),
          ...(deposit === undefined
            ? {}
            : {
                depositAddress: deposit.address,
                depositChain: deposit.chain,
                depositAmount: serializeMoney(deposit.amount),
              }),
        },
      ),
    );
  }

  /**
   * Quotes what the payer must send and allocates the address to send it to.
   *
   * Both are side effects that run before the state is persisted, matching the
   * engine's ordering rule: `allocate` is idempotent, so a crash between here
   * and the write means the resumed step re-derives the same address.
   */
  async #lockDeposit(
    transaction: ClearingTransaction,
    now: Date,
  ): Promise<ClearingDeposit | undefined> {
    // The on-chain-contract path never reaches here: `#lockPrice` branches to
    // `#lockContract`, which locks a signed order instead of an address.
    const intent = await this.#intents.getById(transaction.paymentIntentId);
    const rail = intent.payment;
    if (rail === undefined) return undefined;

    const repository = this.#depositAddresses;
    const deriver = this.#depositDeriver;
    if (repository === undefined || deriver === undefined) {
      throw new ConfigurationError(
        `Payment intent ${intent.id} requests an on-chain rail but this deployment has no chain layer`,
        { paymentIntentId: intent.id, chain: rail.chain, asset: rail.asset },
      );
    }

    const quote = await this.#rates.quote(
      transaction.sourceAmount.asset,
      rail.asset,
      transaction.sourceAmount,
    );
    const amount = convert(transaction.sourceAmount, rail.asset, quote.minorUnitsPerWholeUnit);

    if (!isPositive(amount)) {
      throw new ValidationError("Deposit amount must be greater than zero", {
        amount: amount.amount.toString(),
        asset: amount.asset,
      });
    }

    const allocated = await repository.allocate({
      clearingTransactionId: transaction.id,
      chain: rail.chain,
      asset: rail.asset,
      deriver,
      now,
    });

    return {
      asset: rail.asset,
      chain: rail.chain,
      address: allocated.address,
      amount,
      rate: lockRate(quote, now),
    };
  }

  /**
   * Locks the contract path (#61): the planner prices both legs, locks, and
   * signs the order. The engine checks the signed numbers against the lock —
   * the fee inside the order is what the contract splits on-chain, so a
   * planner that disagrees with itself must not reach a payer.
   *
   * `lock` is a side effect before the persist, like `allocate` on the
   * deposit path. It is not idempotent — a crash in between re-locks with a
   * fresh order — but the orphaned order is harmless: the payer never saw
   * it, and the contract consumes an `intentId` only on success.
   */
  async #lockContract(transaction: ClearingTransaction): Promise<ClearingTransaction> {
    const planner = this.#contractPlanner;
    if (planner === undefined) {
      throw new ConfigurationError(
        `Payment intent ${transaction.paymentIntentId} takes the on-chain-contract path but this deployment has no contract planner`,
        { paymentIntentId: transaction.paymentIntentId },
      );
    }

    const intent = await this.#intents.getById(transaction.paymentIntentId);
    const rail = intent.payment;
    if (rail === undefined) {
      throw new ValidationError(
        `Payment intent ${intent.id} takes the on-chain-contract path but names no payment rail`,
        { paymentIntentId: intent.id },
      );
    }

    const lock = await planner.lock({
      clearingTransactionId: transaction.id,
      paymentIntentId: intent.id,
      merchantId: transaction.merchant.id,
      sourceAmount: transaction.sourceAmount,
      settlementAsset: transaction.settlementAsset,
      payerAsset: rail.asset,
      chain: rail.chain,
    });

    if (
      lock.order.minOut !== lock.settlementAmount.amount ||
      lock.order.fee !== lock.fee.amount ||
      lock.settlementAmount.asset !== transaction.settlementAsset ||
      lock.fee.asset !== transaction.settlementAsset
    ) {
      throw new ValidationError("The signed order disagrees with the lock it came from", {
        orderMinOut: lock.order.minOut.toString(),
        settlementAmount: lock.settlementAmount.amount.toString(),
        orderFee: lock.order.fee.toString(),
        fee: lock.fee.amount.toString(),
        lockAsset: lock.settlementAmount.asset,
        settlementAsset: transaction.settlementAsset,
      });
    }

    const netAmount = subtract(lock.settlementAmount, lock.fee);
    if (!isPositive(netAmount)) {
      throw new ValidationError(
        "Fee consumes the entire settlement amount; nothing would reach the merchant",
        {
          settlementAmount: lock.settlementAmount.amount.toString(),
          fee: lock.fee.amount.toString(),
          asset: lock.settlementAmount.asset,
        },
      );
    }

    return this.#apply(
      transition(
        transaction,
        "PRICE_LOCKED",
        this.#clock.now(),
        {
          rate: lock.rate,
          settlementAmount: lock.settlementAmount,
          fee: lock.fee,
          netAmount,
          contract: {
            order: lock.order,
            payerEstimate: lock.payerEstimate,
            expiresAt: lock.expiresAt,
          },
        },
        {
          rate: lock.rate.minorUnitsPerWholeUnit.toString(),
          rateSource: lock.rate.source,
          settlementAmount: serializeMoney(lock.settlementAmount),
          fee: serializeMoney(lock.fee),
          netAmount: serializeMoney(netAmount),
          payerEstimate: serializeMoney(lock.payerEstimate),
          orderIntentId: lock.order.intentId,
          orderDeadline: lock.order.deadline.toString(),
          orderSigner: lock.order.signer,
          expiresAt: lock.expiresAt.toISOString(),
        },
      ),
    );
  }

  /**
   * The contract already settled on-chain; SETTLING records the reference.
   * No settlement adapter is involved anywhere on this path.
   */
  async #settleContract(transaction: ClearingTransaction): Promise<ClearingTransaction> {
    const txHash = transaction.contract?.txHash;
    if (txHash === undefined) {
      throw new ValidationError(
        `Clearing transaction ${transaction.id} is CLEARING on the contract path without a completion tx hash`,
        { id: transaction.id },
      );
    }
    return this.#apply(
      transition(
        transaction,
        "SETTLING",
        this.#clock.now(),
        { providerReference: txHash },
        { providerReference: txHash },
      ),
    );
  }

  /** Books the on-chain settlement: value left Mayarin's flow to the merchant Safe. */
  async #confirmContract(transaction: ClearingTransaction): Promise<ClearingTransaction> {
    const providerReference = transaction.providerReference;
    if (providerReference === undefined) {
      throw new ValidationError(
        `Clearing transaction ${transaction.id} is SETTLING without a provider reference`,
        { id: transaction.id },
      );
    }
    await this.#ledger.post(settledPosting(transaction));
    return this.#apply(
      transition(transaction, "SETTLED", this.#clock.now(), {}, { providerReference }),
    );
  }

  /**
   * Fails a contract-path payment whose lock passed its deadline plus grace.
   * The contract enforces the same deadline on-chain, so no settlement can
   * arrive for a payment failed here once the grace covers indexing lag.
   */
  #assertContractNotExpired(transaction: ClearingTransaction): void {
    const contract = transaction.contract;
    if (contract === undefined) return;
    const graceMs = this.#contractExpiryGraceSeconds * 1_000;
    if (this.#clock.now().getTime() > contract.expiresAt.getTime() + graceMs) {
      throw new QuoteExpiredError(
        `Quote lock for clearing transaction ${transaction.id} expired before the payment completed`,
        {
          id: transaction.id,
          expiresAt: contract.expiresAt.toISOString(),
          graceSeconds: this.#contractExpiryGraceSeconds,
        },
      );
    }
  }

  /** Hands the payout to the settlement adapter. */
  async #settle(transaction: ClearingTransaction): Promise<ClearingTransaction> {
    const adapter = this.#adapters.get(transaction.provider);
    const result = await adapter.settle(this.#settlementRequest(transaction));

    return this.#apply(
      transition(
        transaction,
        "SETTLING",
        this.#clock.now(),
        { providerReference: result.providerReference },
        { provider: transaction.provider, providerReference: result.providerReference },
      ),
    );
  }

  /** Asks the provider whether the payout landed. */
  async #confirmSettlement(transaction: ClearingTransaction): Promise<ClearingTransaction | null> {
    const providerReference = transaction.providerReference;
    if (providerReference === undefined) {
      throw new ValidationError(
        `Clearing transaction ${transaction.id} is SETTLING without a provider reference`,
        { id: transaction.id },
      );
    }

    const adapter = this.#adapters.get(transaction.provider);
    const status = await adapter.status(providerReference);

    switch (status.state) {
      case "SUCCEEDED": {
        // Internal settlements keep the value in Mayarin as a merchant holding
        // liability; external rails return it to treasury once delivery confirms.
        const posting =
          adapter.mode === "internal"
            ? internalSettledPosting(transaction)
            : settledPosting(transaction);
        await this.#ledger.post(posting);
        return this.#apply(
          transition(transaction, "SETTLED", this.#clock.now(), {}, { providerReference }),
        );
      }
      case "PENDING":
        return null;
      case "FAILED":
      case "REFUNDED":
        throw new ValidationError(
          status.failureReason ?? `Settlement ${providerReference} is ${status.state}`,
          { providerReference, state: status.state },
        );
    }
  }

  #settlementRequest(transaction: ClearingTransaction): SettlementRequest {
    return {
      clearingTransactionId: transaction.id,
      paymentIntentId: transaction.paymentIntentId,
      merchant: transaction.merchant,
      amount: requireAmount(transaction, "netAmount"),
      // One settlement per clearing transaction: replaying this key must never
      // produce a second payout.
      idempotencyKey: `${transaction.id}:settle`,
      metadata: { paymentIntentId: transaction.paymentIntentId },
    };
  }

  async #fail(
    transaction: ClearingTransaction,
    reason: string,
    code: string,
  ): Promise<ClearingTransaction> {
    const failed = await this.#apply(
      failTransaction(transaction, { reason, code, at: this.#clock.now() }),
    );

    const intent = await this.#intents.getById(transaction.paymentIntentId);
    // A terminal intent (already completed or expired) stays as it is; the
    // clearing failure is still recorded against the transaction.
    if (intent.status === "CONFIRMED" || intent.status === "PROCESSING") {
      await this.#intents.markFailed(intent, reason);
    }

    return failed;
  }

  async #apply(result: TransitionResult): Promise<ClearingTransaction> {
    const { transaction, event } = result;
    await this.#repository.update(transaction, transaction.version - 1, [event]);
    await this.#publish([event]);
    return transaction;
  }

  async #publish(events: readonly ClearingEvent[]): Promise<void> {
    await this.#events.publish(events.map(toDomainEvent));
  }
}

function toDomainEvent(event: ClearingEvent): DomainEvent {
  return {
    id: event.id,
    type: `clearing.${event.toState.toLowerCase()}`,
    aggregateId: event.clearingTransactionId,
    occurredAt: event.occurredAt,
    payload: {
      sequence: event.sequence,
      from: event.fromState,
      to: event.toState,
      ...event.payload,
    },
  };
}

function requireAmount(
  transaction: ClearingTransaction,
  field: "settlementAmount" | "netAmount" | "fee",
) {
  const value = transaction[field];
  if (value === undefined) {
    throw new InvalidStateTransitionError(
      `Clearing transaction ${transaction.id} reached ${transaction.state} without ${field}`,
      { id: transaction.id, state: transaction.state, field },
    );
  }
  return value;
}

function requireContract(transaction: ClearingTransaction) {
  const contract = transaction.contract;
  if (contract === undefined) {
    throw new InvalidStateTransitionError(
      `Clearing transaction ${transaction.id} reached ${transaction.state} on the contract path without a lock`,
      { id: transaction.id, state: transaction.state },
    );
  }
  return contract;
}

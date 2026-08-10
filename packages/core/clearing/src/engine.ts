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

import type {
  DepositAddressDeriver,
  DepositAddressRepository,
  PaymentCompletion,
} from "@mayarin/chain";
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
  ProviderError,
  QuoteExpiredError,
  roundUpToPayerPrecision,
  serializeMoney,
  subtract,
  ValidationError,
} from "@mayarin/shared";
import type { ContractPaymentPlanner } from "./contract-path.ts";
import type { FeePolicy } from "./fees.ts";
import {
  assetReceivedPosting,
  clearingPosting,
  contractSettledPosting,
  depositAssetReceivedPosting,
  internalSettledPosting,
  settledPosting,
} from "./postings.ts";
import { lockRate, type RateProvider } from "./rate.ts";
import type { ClearingRepository } from "./repository.ts";
import { canTransition, isTerminal } from "./state-machine.ts";
import {
  createClearingTransaction,
  failTransaction,
  type TransitionResult,
  transition,
} from "./transaction.ts";
import type { TreasuryExecutor } from "./treasury.ts";
import type {
  ClearingDeposit,
  ClearingEvent,
  ClearingTransaction,
  OnChainSettlement,
} from "./types.ts";

/**
 * Facts the outside world hands the engine mid-step.
 *
 * Not state: they are true of this call, and the step decides what to persist.
 */
interface ClearingSignals {
  readonly assetReceived?: boolean;
  readonly contractTxHash?: string;
  /** What `PaymentCompleted` reported, on the contract path (#12). */
  readonly onChain?: OnChainSettlement;
}

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
  /**
   * Moves a matched deposit into the router (#69). Absent for a deployment
   * without treasury execution: such a deployment's locks never sign an
   * order, so its deposit path settles internally. A payment whose lock
   * *did* sign an order parks in this engine until a process with an
   * executor resumes it — the lock decides how a payment settles, not the
   * wiring of whichever process happens to advance it (#104).
   */
  readonly treasuryExecutor?: TreasuryExecutor;
  /**
   * Receives swap output above `minOut` on the deposit path — the signed
   * order's `refundTo`.
   *
   * Not the payer: a deposit-path payer scanned a QR or withdrew from an
   * exchange, so no address of theirs is known, and the sending address of an
   * exchange withdrawal is an omnibus hot wallet where a refund would be
   * credited to nobody. The payer sent a fixed quoted amount and is owed
   * nothing more, so the excess is Mayarin's — symmetric with a shortfall,
   * which Mayarin absorbs. Both land in `FX_RESULT`.
   */
  readonly treasuryAddress?: string;
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
  readonly #treasuryExecutor: TreasuryExecutor | undefined;
  readonly #treasuryAddress: string | undefined;
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
    this.#treasuryExecutor = options.treasuryExecutor;
    this.#treasuryAddress = options.treasuryAddress;
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

  /** The transaction whose signed order carries this on-chain `intentId` (#8). */
  async findByContractIntentId(intentId: string): Promise<ClearingTransaction | null> {
    return this.#repository.findByContractIntentId(intentId);
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
    completion: PaymentCompletion,
  ): Promise<ClearingProgress> {
    const transaction = await this.getById(id);
    if (transaction.executionPath !== "on-chain-contract") {
      // The deposit path reaches the router too, through the treasury executor
      // (#11): the engine made that call itself and recorded what came back, so
      // the indexer's log is an echo of work already done rather than news.
      // Advancing is the honest answer — a no-op for a payment that finished,
      // and a resume for one that stalled after the call went through.
      if (transaction.contract !== undefined) return this.#advance(transaction);
      throw new ValidationError(`Clearing transaction ${id} is not on the on-chain-contract path`, {
        id,
        executionPath: transaction.executionPath,
      });
    }
    if (transaction.state !== "PAYMENT_PENDING") {
      // Already past this point: nothing to record, just keep going.
      return this.#advance(transaction);
    }
    // The chain's figures are recorded alongside the locked ones, not instead
    // of them: the comparison is the reason they are carried this far.
    const asset = transaction.settlementAsset;
    return this.#advance(transaction, {
      assetReceived: true,
      contractTxHash: completion.txHash,
      onChain: {
        settledAmount: { amount: completion.settledAmount, asset },
        fee: { amount: completion.fee, asset },
        refundAmount: { amount: completion.refundAmount, asset },
      },
    });
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
    signals: ClearingSignals = {},
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
        // A state the machine cannot fail from is one where failing is not the
        // honest answer either: `SETTLED` means the money has already moved, so
        // there is nothing to fail — only a step left to finish. Attempting it
        // anyway raised a second, misleading error that buried the first, and
        // left the payment wedged with no way to read what had gone wrong.
        if (!canTransition(current.state, "FAILED")) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        const code = isMayarinError(error) ? error.code : "CLEARING_FAILED";
        const details = isMayarinError(error) ? error.details : {};
        return { transaction: await this.#fail(current, reason, code, details), waiting: false };
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
    signals: ClearingSignals,
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
              {
                contract: { ...contract, ...(txHash === undefined ? {} : { txHash }) },
                ...(signals.onChain === undefined ? {} : { onChain: signals.onChain }),
              },
              {
                settlementAmount: serializeMoney(requireAmount(transaction, "settlementAmount")),
                ...(txHash === undefined ? {} : { txHash }),
              },
            ),
          );
        }

        if (!this.#autoConfirmAssetReceipt && signals.assetReceived !== true) return null;
        // Split the receipt only when something will actually convert the
        // deposit. The two postings are a pair: the receipt stops crediting
        // `MERCHANT_PAYABLE` and the swap starts, so booking the first without
        // the second would leave `clearingPosting` debiting a payable nothing
        // had credited — worse books than the hole this fixes.
        //
        // Without a signed order the deposit settles internally, acquiring
        // the settlement asset at receipt, and the original posting is correct.
        await this.#ledger.post(
          this.#splitsDepositReceipt(transaction)
            ? depositAssetReceivedPosting(transaction)
            : assetReceivedPosting(transaction),
        );
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
        // The swap must be booked before `clearingPosting`, which debits the
        // `MERCHANT_PAYABLE` the swap credits. On the deposit path the receipt
        // no longer credits it — that is the whole point of splitting them.
        const executed = await this.#executeTreasury(transaction);
        await this.#ledger.post(clearingPosting(executed));
        return this.#apply(transition(executed, "CLEARING", this.#clock.now()));
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
    // A deposit that will be executed needs a signed order, and the order must
    // be priced by whatever prices the swap. Running `RateProvider` here and
    // the planner for the order would be two prices for one payment, free to
    // disagree; so when execution is wired, the planner prices this path too.
    if (await this.#executesDeposit(transaction)) {
      return this.#lockExecutableDeposit(transaction);
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
      quote.scaledRate,
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
          rate: quote.scaledRate.toString(),
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
  /**
   * Whether this deposit-path payment will be executed into the router.
   *
   * Requires an executor, a rail (so there is a deposit at all), and a planner
   * to sign the order. A deployment missing any of them keeps the original
   * behaviour: price through `RateProvider`, settle internally.
   */
  async #executesDeposit(transaction: ClearingTransaction): Promise<boolean> {
    if (this.#treasuryExecutor === undefined || this.#contractPlanner === undefined) return false;
    if (transaction.executionPath === "on-chain-contract") return false;

    const intent = await this.#intents.getById(transaction.paymentIntentId);
    return intent.payment !== undefined;
  }

  /**
   * Locks a deposit that the treasury executor will convert.
   *
   * One pricing pass, the planner's, producing both the signed order and the
   * amount the payer must send. `payerEstimate` is slippage-grossed, which is
   * exactly right here: the payer sends it, the swap clears `minOut`, and the
   * excess goes to `refundTo` — the treasury — where it is booked as an
   * `FX_RESULT` credit. A shortfall debits the same account. The merchant is
   * paid the locked net either way.
   */
  async #lockExecutableDeposit(transaction: ClearingTransaction): Promise<ClearingTransaction> {
    const planner = this.#contractPlanner;
    const treasury = this.#treasuryAddress;

    if (planner === undefined || treasury === undefined) {
      throw new ConfigurationError(
        `Payment ${transaction.paymentIntentId} has a treasury executor but no ${planner === undefined ? "contract planner" : "treasury address"} to sign an order with`,
        { paymentIntentId: transaction.paymentIntentId },
      );
    }

    const intent = await this.#intents.getById(transaction.paymentIntentId);
    const rail = intent.payment;
    if (rail === undefined) {
      throw new ValidationError(`Payment intent ${intent.id} names no payment rail`, {
        paymentIntentId: intent.id,
      });
    }

    const repository = this.#depositAddresses;
    const deriver = this.#depositDeriver;
    if (repository === undefined || deriver === undefined) {
      throw new ConfigurationError(
        `Payment intent ${intent.id} requests an on-chain rail but this deployment has no chain layer`,
        { paymentIntentId: intent.id, chain: rail.chain, asset: rail.asset },
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
      // The payer has no address on this path; excess is Mayarin's.
      payerAddress: treasury,
      // Price freshness and execution availability are different clocks. A
      // scanning or custodial payer may fund until the intent expires, and the
      // watcher still needs confirmation/indexing time after that.
      orderExpiresAt: new Date(
        intent.expiresAt.getTime() + this.#contractExpiryGraceSeconds * 1_000,
      ),
    });

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

    // The planner prices at the asset's native precision. A payer-facing
    // deposit must use the registry's payable precision instead, and must
    // round up so the displayed/encoded amount can never underfund the lock.
    const payerAmount = roundUpToPayerPrecision(lock.payerEstimate);

    if (!isPositive(payerAmount)) {
      throw new ValidationError("Deposit amount must be greater than zero", {
        amount: payerAmount.amount.toString(),
        asset: payerAmount.asset,
      });
    }

    const now = this.#clock.now();
    const allocated = await repository.allocate({
      clearingTransactionId: transaction.id,
      chain: rail.chain,
      asset: rail.asset,
      deriver,
      now,
    });

    const deposit: ClearingDeposit = {
      asset: rail.asset,
      chain: rail.chain,
      address: allocated.address,
      // What the payer must send. Grossed, so a normal fill clears `minOut`.
      amount: payerAmount,
      rate: lock.rate,
    };

    return this.#apply(
      transition(
        transaction,
        "PRICE_LOCKED",
        now,
        {
          rate: lock.rate,
          settlementAmount: lock.settlementAmount,
          fee: lock.fee,
          netAmount,
          deposit,
          contract: {
            order: lock.order,
            payerEstimate: payerAmount,
            expiresAt: lock.expiresAt,
          },
        },
        {
          rate: lock.rate.scaledRate.toString(),
          rateSource: lock.rate.source,
          settlementAmount: serializeMoney(lock.settlementAmount),
          fee: serializeMoney(lock.fee),
          netAmount: serializeMoney(netAmount),
          depositAddress: deposit.address,
          depositChain: deposit.chain,
          depositAmount: serializeMoney(deposit.amount),
          orderIntentId: lock.order.intentId,
          refundTo: lock.order.refundTo,
        },
      ),
    );
  }

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
    // Rounded up to what a payer can actually type. ETH converts to eighteen
    // decimals, and an amount written out that far is one no wallet field
    // accepts and no human enters correctly — so it is entered short, and a
    // short deposit never funds, because funding wants the total to *reach*
    // what is owed. Rounding up costs the payer dust and always clears. Done
    // here rather than at display time so the address, the QR and the figure on
    // screen all carry the same number.
    const amount = roundUpToPayerPrecision(
      convert(transaction.sourceAmount, rail.asset, quote.scaledRate),
    );

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
    if (rail.payerAddress === undefined) {
      // The signed order's `refundTo` returns the payer's change; without an
      // address there is nowhere safe to sign it to.
      throw new ValidationError(
        `Payment intent ${intent.id} takes the on-chain-contract path but its rail names no payer address`,
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
      payerAddress: rail.payerAddress,
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
          rate: lock.rate.scaledRate.toString(),
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
  /**
   * Converts a matched deposit into the settlement asset (#69).
   *
   * A no-op for anything that is not a deposit-path payment whose lock signed
   * an order: the contract path already swapped and settled atomically
   * on-chain, and a fiat receipt has nothing to convert.
   *
   * A payment that carries a signed order but reaches a process with no
   * executor parks instead of falling through to the adapter — the lock
   * promised on-chain settlement, and only `resumeStuck` in a process that
   * has an executor can keep that promise (#104).
   *
   * Runs as a side effect *before* the state is persisted, like every other
   * step in this engine. A crash between the submission and the transition
   * means the resumed step sweeps a drained forwarder (a no-op) and resubmits
   * an order the contract has already consumed (`AlreadyConsumed`) — which is
   * why the on-chain guard matters more than any flag this engine could keep.
   */
  async #executeTreasury(transaction: ClearingTransaction): Promise<ClearingTransaction> {
    if (!this.#splitsDepositReceipt(transaction)) return transaction;

    const executor = this.#treasuryExecutor;
    if (executor === undefined) {
      throw new ProviderError(
        `Clearing transaction ${transaction.id} carries a signed order, but this process has no treasury executor`,
        { id: transaction.id },
      );
    }

    const execution = await executor.execute(transaction);
    const contract = transaction.contract;

    // The executor knows its own `txHash`, so the deposit path does not wait on
    // the settlement indexer to learn it (#8 serves the contract path, where
    // the payer submitted the transaction and Mayarin did not see it).
    return contract === undefined
      ? transaction
      : { ...transaction, contract: { ...contract, txHash: execution.txHash } };
  }

  /**
   * Whether this payment's receipt and swap are booked separately.
   *
   * One predicate for both halves, so the receipt posting and the swap can
   * never disagree about which scheme a payment is on — that disagreement is
   * the only way this design can produce unbalanced books.
   *
   * Reads only the persisted transaction, never this process's wiring: the
   * signed order is the marker the lock wrote when an executor priced the
   * payment. Two differently wired processes must answer alike here, or the
   * one without an executor settles the payment internally and marks it
   * SUCCESS while the deposit sits unswept (#104).
   */
  #splitsDepositReceipt(transaction: ClearingTransaction): boolean {
    return (
      transaction.contract !== undefined &&
      transaction.deposit !== undefined &&
      transaction.executionPath !== "on-chain-contract"
    );
  }

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
    // Booked from what the chain reported when the indexer supplied it, and
    // from the lock otherwise — an older payment settled before this shipped
    // has no on-chain record to book from.
    const onChain = transaction.onChain;
    await this.#ledger.post(
      onChain === undefined
        ? settledPosting(transaction)
        : contractSettledPosting(transaction, onChain.settledAmount),
    );
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
    details: Readonly<Record<string, unknown>> = {},
  ): Promise<ClearingTransaction> {
    const failed = await this.#apply(
      failTransaction(transaction, { reason, code, at: this.#clock.now() }, details),
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

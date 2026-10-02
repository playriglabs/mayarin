/**
 * Payment intent application service.
 *
 * Owns the intent aggregate: creation (idempotent), expiry, and the lifecycle
 * transitions the clearing engine drives. It never talks to a settlement
 * provider — that is the clearing engine's job.
 */

import { createHash } from "node:crypto";
import type { ChainId } from "@mayarin/chain";
import {
  type AssetCode,
  type Clock,
  type EventPublisher,
  getAsset,
  IdempotencyConflictError,
  type Money,
  NotFoundError,
  noopEventPublisher,
  serializeMoney,
  ValidationError,
} from "@mayarin/shared";
import type { StablecoinRegistry } from "@mayarin/stablecoin";
import { PAYMENT_INTENT_EVENT, type PaymentIntentEventType, paymentIntentEvent } from "./events.ts";
import {
  choosePayment as choosePaymentOn,
  confirm as confirmIntent,
  createPaymentIntent,
  isExpired,
  markCompleted as markIntentCompleted,
  markExpired as markIntentExpired,
  markFailed as markIntentFailed,
  markProcessing as markIntentProcessing,
  reopenIntent,
} from "./intent.ts";
import {
  acceptedPayerAssets,
  type MerchantAssetPolicy,
  type MerchantAssetPolicySource,
  settlementAssetOnChain,
} from "./merchant-policy.ts";
import type { PayerStandingSource } from "./payer-standing.ts";
import type { ListPaymentIntentsOptions, PaymentIntentRepository } from "./repository.ts";
import type {
  EscrowRequest,
  ExecutionPath,
  MerchantSnapshot,
  PaymentIntent,
  PaymentRail,
  PaymentSource,
} from "./types.ts";

export interface CreatePaymentIntentCommand {
  readonly merchant: MerchantSnapshot;
  readonly amount: Money;
  readonly source: PaymentSource;
  readonly settlementAsset?: AssetCode;
  readonly provider?: string;
  readonly payment?: PaymentRail;
  /** How the `payment` rail is executed. Ignored for a fiat-only intent. */
  readonly executionPath?: ExecutionPath;
  /**
   * Settle into escrow (#304). Absent: the merchant's buyer-protection default
   * applies where it can. `null`: never, whatever the merchant's default.
   */
  readonly escrow?: EscrowRequest | null;
  readonly metadata?: Readonly<Record<string, string>>;
  /** The merchant's own order/invoice id. Opaque to Mayarin, indexed for lookup. */
  readonly merchantReference?: string;
  readonly idempotencyKey?: string;
  readonly ttlSeconds?: number;
}

export interface PaymentIntentServiceOptions {
  readonly repository: PaymentIntentRepository;
  readonly clock: Clock;
  readonly events?: EventPublisher;
  /**
   * Admissible-asset catalog. When injected, the service rejects a settlement
   * asset it does not admit and a payer leg that is not a deposit asset, before
   * any state is created. Optional so unit tests of intent mechanics need not
   * build one; the composition root always injects it.
   */
  readonly registry?: StablecoinRegistry;
  /**
   * Per-merchant asset policy. When injected, the merchant's own settlement
   * asset outranks the deployment default, and a payer asset the merchant does
   * not accept is rejected. Optional for the same reason `registry` is.
   */
  readonly merchantPolicies?: MerchantAssetPolicySource;
  /**
   * Chains with an escrow factory. A merchant's buyer protection applies only
   * there; elsewhere the payment settles as usual. Empty or absent: never.
   */
  readonly escrowChains?: readonly ChainId[];
  /**
   * Whether a payer wallet has lost the right to buyer protection (#314). A
   * flagged wallet pays the merchant directly, and an escrow the merchant
   * requires is refused. Absent: every wallet is in good standing.
   */
  readonly payerStanding?: PayerStandingSource;
  readonly defaults: {
    readonly settlementAsset: AssetCode;
    readonly provider: string;
    /** Default execution path for an intent that names a `payment` rail. */
    readonly executionPath: ExecutionPath;
    readonly ttlSeconds: number;
  };
}

export class PaymentIntentService {
  readonly #repository: PaymentIntentRepository;
  readonly #clock: Clock;
  readonly #events: EventPublisher;
  readonly #registry: StablecoinRegistry | undefined;
  readonly #merchantPolicies: MerchantAssetPolicySource | undefined;
  readonly #escrowChains: readonly ChainId[];
  readonly #payerStanding: PayerStandingSource | undefined;
  readonly #defaults: PaymentIntentServiceOptions["defaults"];

  constructor(options: PaymentIntentServiceOptions) {
    this.#repository = options.repository;
    this.#clock = options.clock;
    this.#events = options.events ?? noopEventPublisher;
    this.#registry = options.registry;
    this.#merchantPolicies = options.merchantPolicies;
    this.#escrowChains = options.escrowChains ?? [];
    this.#payerStanding = options.payerStanding;
    this.#defaults = options.defaults;
  }

  /**
   * Creates an intent.
   *
   * With an idempotency key, replaying the same request returns the original
   * intent; reusing the key for different parameters is rejected rather than
   * quietly returning something the caller did not ask for.
   */
  async create(command: CreatePaymentIntentCommand): Promise<PaymentIntent> {
    // Precedence is deliberate: an explicit request wins, then the merchant's
    // own choice, then the deployment. A merchant who configured USDC is not
    // paid in the deployment default just because the caller stayed silent.
    const policy = await this.#merchantPolicies?.policyFor(command.merchant.id);
    const settlementAsset =
      command.settlementAsset ??
      (policy === undefined
        ? undefined
        : command.payment === undefined
          ? policy.settlementAsset
          : settlementAssetOnChain(policy, command.payment.chain)) ??
      this.#defaults.settlementAsset;
    const provider = command.provider ?? this.#defaults.provider;

    // Both on-chain paths need a rail: the contract path submits calldata for
    // one, and an x402 payer authorises a transfer of one. Only a fiat-only
    // intent has neither.
    if (
      (command.executionPath === "on-chain-contract" || command.executionPath === "x402") &&
      command.payment === undefined
    ) {
      throw new ValidationError(`${command.executionPath} execution path requires a payment rail`, {
        executionPath: command.executionPath,
      });
    }
    // The execution path only applies to an on-chain rail. A fiat-only intent
    // (no `payment`) has no payer asset to execute, so it carries no path even
    // if a default is configured.
    const executionPath =
      command.payment !== undefined
        ? (command.executionPath ?? this.#defaults.executionPath)
        : undefined;

    if (
      this.#registry !== undefined &&
      !(await this.#registry.isSettlementAsset(settlementAsset))
    ) {
      throw new ValidationError(
        `Settlement asset ${settlementAsset} is not admitted by the stablecoin registry`,
        {
          settlementAsset,
        },
      );
    }

    if (command.payment !== undefined && executionPath !== undefined) {
      await this.#assertPayerRail(command.merchant.id, command.payment, executionPath, policy);
    }

    if (command.escrow != null) await this.#assertProtectable(command.payment);
    const escrow =
      command.escrow === null
        ? undefined
        : (command.escrow ?? (await this.#protection(policy, command.payment, executionPath)));

    const fingerprint = fingerprintOf(command, settlementAsset, provider, executionPath);

    if (command.idempotencyKey !== undefined) {
      const existing = await this.#repository.findByIdempotencyKey(command.idempotencyKey);
      if (existing !== null) {
        if (existing.requestFingerprint !== fingerprint) {
          throw new IdempotencyConflictError(
            `Idempotency key "${command.idempotencyKey}" was already used with different parameters`,
            { idempotencyKey: command.idempotencyKey, existingIntentId: existing.id },
          );
        }
        return existing;
      }
    }

    const intent = createPaymentIntent({
      merchant: command.merchant,
      amount: command.amount,
      settlementAsset,
      provider,
      ...(command.payment === undefined ? {} : { payment: command.payment }),
      ...(executionPath === undefined ? {} : { executionPath }),
      ...(escrow === undefined ? {} : { escrow }),
      source: command.source,
      ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
      ...(command.merchantReference === undefined
        ? {}
        : { merchantReference: command.merchantReference }),
      ...(command.idempotencyKey === undefined ? {} : { idempotencyKey: command.idempotencyKey }),
      requestFingerprint: fingerprint,
      ttlSeconds: command.ttlSeconds ?? this.#defaults.ttlSeconds,
      now: this.#clock.now(),
    });

    await this.#repository.insert(intent);
    await this.#events.publish([paymentIntentEvent(PAYMENT_INTENT_EVENT.created, intent)]);
    return intent;
  }

  /** Loads an intent, settling any due expiry first so reads never report stale state. */
  async getById(id: string): Promise<PaymentIntent> {
    const intent = await this.#repository.findById(id);
    if (intent === null) {
      throw new NotFoundError(`Payment intent ${id} not found`, { id });
    }
    return this.expireIfDue(intent);
  }

  /**
   * Lists intents, newest first.
   *
   * Reads are not expired on the way out the way `getById` expires them: a list
   * is a report, and settling every due expiry to render one would turn a read
   * into an unbounded write. `expiresAt` is on every row, so a reader can see
   * which of them are past due.
   */
  async list(options: ListPaymentIntentsOptions = {}): Promise<readonly PaymentIntent[]> {
    return this.#repository.list(options);
  }

  async expireIfDue(intent: PaymentIntent): Promise<PaymentIntent> {
    const now = this.#clock.now();
    if (!isExpired(intent, now)) return intent;
    return this.#apply(
      markIntentExpired(intent, now),
      intent.version,
      PAYMENT_INTENT_EVENT.expired,
    );
  }

  /**
   * Records the payer's rail on an intent minted without one — a storefront's
   * cart checkout, answered on the hosted payment page.
   *
   * The same checks a rail named at minting passes, so choosing later is never
   * a way around them. The same rail asked for twice is a replay and changes
   * nothing, which lets a buyer retry a confirm that failed after the choice
   * had already been recorded.
   */
  async choosePayment(
    id: string,
    payment: PaymentRail,
    executionPath?: ExecutionPath,
  ): Promise<PaymentIntent> {
    const intent = await this.getById(id);
    const path = executionPath ?? this.#defaults.executionPath;
    const policy = await this.#merchantPolicies?.policyFor(intent.merchant.id);
    // An intent minted without a rail took the merchant-wide asset; a chain
    // with its own settlement asset replaces it once the chain is known.
    const settlementAsset =
      policy?.settlementAssetByChain?.[payment.chain] ?? intent.settlementAsset;
    if (intent.escrow !== undefined) await this.#assertProtectable(payment);
    const next = choosePaymentOn(
      intent,
      payment,
      path,
      settlementAsset,
      this.#clock.now(),
      await this.#protection(policy, payment, path),
    );
    if (next === intent) return intent;

    await this.#assertPayerRail(intent.merchant.id, payment, path, policy);
    return this.#apply(next, intent.version, PAYMENT_INTENT_EVENT.railChosen);
  }

  /**
   * The merchant's buyer protection, where it can apply (#304): the payer named
   * the wallet they would release from, the rail is not x402, and the chain has
   * an escrow factory. A payer paying from an exchange names no wallet, cannot
   * release anything, and is paid out as usual — so protection is something
   * the merchant offers and the payer takes up by connecting.
   */
  async #protection(
    policy: MerchantAssetPolicy | undefined,
    payment: PaymentRail | undefined,
    executionPath: ExecutionPath | undefined,
  ): Promise<EscrowRequest | undefined> {
    const protection = policy?.buyerProtection;
    if (protection === undefined || payment?.payerAddress === undefined) return undefined;
    if (executionPath === undefined || executionPath === "x402") return undefined;
    if (!this.#escrowChains.includes(payment.chain)) return undefined;
    // A wallet that keeps losing disputes is not offered protection (#314):
    // the payment still goes through, straight to the merchant.
    return (await this.#flagged(payment.payerAddress)) ? undefined : protection;
  }

  /** An escrow the merchant requires cannot be taken by a flagged wallet (#314). */
  async #assertProtectable(payment: PaymentRail | undefined): Promise<void> {
    if (payment?.payerAddress === undefined) return;
    if (await this.#flagged(payment.payerAddress)) {
      throw new ValidationError(
        "This payment requires buyer protection, which this wallet can no longer use",
        { payerAddress: payment.payerAddress },
      );
    }
  }

  async #flagged(payer: string): Promise<boolean> {
    return (await this.#payerStanding?.isFlagged(payer)) ?? false;
  }

  async confirm(id: string): Promise<PaymentIntent> {
    const intent = await this.getById(id);
    // Confirming an intent that is already past CREATED is a safe replay — a
    // retried request must not fail a payment that is already under way.
    // Expired and failed intents still refuse, via the transition table.
    if (
      intent.status === "CONFIRMED" ||
      intent.status === "PROCESSING" ||
      intent.status === "COMPLETED"
    ) {
      return intent;
    }
    return this.#apply(
      confirmIntent(intent, this.#clock.now()),
      intent.version,
      PAYMENT_INTENT_EVENT.confirmed,
    );
  }

  async markProcessing(
    intent: PaymentIntent,
    clearingTransactionId: string,
  ): Promise<PaymentIntent> {
    if (intent.status === "PROCESSING") return intent;
    return this.#apply(
      markIntentProcessing(intent, clearingTransactionId, this.#clock.now()),
      intent.version,
      PAYMENT_INTENT_EVENT.processing,
    );
  }

  async markCompleted(intent: PaymentIntent): Promise<PaymentIntent> {
    if (intent.status === "COMPLETED") return intent;
    return this.#apply(
      markIntentCompleted(intent, this.#clock.now()),
      intent.version,
      PAYMENT_INTENT_EVENT.completed,
    );
  }

  /** Reopens a failed intent for a retried settlement. See `reopenIntent`. */
  async reopen(intent: PaymentIntent): Promise<PaymentIntent> {
    if (intent.status !== "FAILED") return intent;
    return this.#apply(
      reopenIntent(intent, this.#clock.now()),
      intent.version,
      PAYMENT_INTENT_EVENT.reopened,
    );
  }

  async markFailed(intent: PaymentIntent, reason: string): Promise<PaymentIntent> {
    if (intent.status === "FAILED") return intent;
    return this.#apply(
      markIntentFailed(intent, reason, this.#clock.now()),
      intent.version,
      PAYMENT_INTENT_EVENT.failed,
    );
  }

  /**
   * Refuses a payer rail before it is recorded — at minting, or chosen later.
   *
   * One place, so a rail chosen on the hosted page after a cart checkout passes
   * exactly the checks a rail named at minting does.
   */
  async #assertPayerRail(
    merchantId: string,
    payment: PaymentRail,
    executionPath: ExecutionPath,
    policy: MerchantAssetPolicy | undefined,
  ): Promise<void> {
    // Read on the rail's own chain (#244): a merchant who accepts ETH accepts
    // it where ETH exists, not on a chain that has none.
    if (policy !== undefined) {
      const accepted = acceptedPayerAssets(policy, payment.chain);
      if (accepted.length > 0 && !accepted.includes(payment.asset)) {
        throw new ValidationError(
          `Merchant ${merchantId} does not accept ${payment.asset} on ${payment.chain}`,
          {
            merchantId,
            asset: payment.asset,
            chain: payment.chain,
            acceptedAssets: [...accepted],
          },
        );
      }
    }

    // The contract path signs the payer's change back to `refundTo`, so there
    // is no order to plan without the payer's address. Checked against the
    // *resolved* path, not the requested one: a caller who names no path takes
    // the deployment's, and a rail the price lock will refuse is a bad request
    // — letting it through mints an intent whose only future is FAILED.
    if (executionPath === "on-chain-contract" && payment.payerAddress === undefined) {
      throw new ValidationError(
        "on-chain-contract execution path requires the payer's address on the rail",
        { executionPath, asset: payment.asset },
      );
    }

    // Only a stablecoin payer asset is the registry's to admit. A native asset
    // has no token address and is not a stablecoin, so asking a stablecoin
    // registry about it is a category error — it can only ever answer no, which
    // would refuse every ETH deposit the product exists to take. What bounds a
    // native payer asset instead is the merchant's `acceptedAssets` above and
    // the chain the deployment configures.
    if (this.#registry !== undefined && getAsset(payment.asset).kind === "stablecoin") {
      const { asset, chain } = payment;
      if (!(await this.#registry.isDepositAsset(asset, chain))) {
        throw new ValidationError(
          `Payer asset ${asset} on ${chain} is not a deposit asset the stablecoin registry admits`,
          { asset, chain },
        );
      }
    }
  }

  async #apply(
    next: PaymentIntent,
    expectedVersion: number,
    eventType: PaymentIntentEventType,
  ): Promise<PaymentIntent> {
    await this.#repository.update(next, expectedVersion);
    await this.#events.publish([paymentIntentEvent(eventType, next)]);
    return next;
  }
}

/**
 * Stable fingerprint of the parameters that define an intent.
 *
 * Deliberately excludes metadata, the merchant reference and TTL: none of them
 * change what is owed to whom, so a retry that only differs there is still the
 * same payment.
 */
function fingerprintOf(
  command: CreatePaymentIntentCommand,
  settlementAsset: AssetCode,
  provider: string,
  executionPath: ExecutionPath | undefined,
): string {
  const canonical = JSON.stringify([
    command.merchant.id,
    serializeMoney(command.amount),
    settlementAsset,
    provider,
    command.payment === undefined ? "none" : `${command.payment.chain}:${command.payment.asset}`,
    executionPath ?? "default",
    command.source.type === "qr" ? command.source.payload : "manual",
    // Appended only when present, so every fingerprint stored before escrow
    // existed still matches its replay.
    ...(command.escrow === undefined
      ? []
      : command.escrow === null
        ? ["escrow:none"]
        : [`escrow:${command.escrow.holdSeconds}:${command.escrow.arbiter ?? ""}`]),
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

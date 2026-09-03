/**
 * Payment intent application service.
 *
 * Owns the intent aggregate: creation (idempotent), expiry, and the lifecycle
 * transitions the clearing engine drives. It never talks to a settlement
 * provider — that is the clearing engine's job.
 */

import { createHash } from "node:crypto";
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
  confirm as confirmIntent,
  createPaymentIntent,
  isExpired,
  markCompleted as markIntentCompleted,
  markExpired as markIntentExpired,
  markFailed as markIntentFailed,
  markProcessing as markIntentProcessing,
} from "./intent.ts";
import type { MerchantAssetPolicySource } from "./merchant-policy.ts";
import type { ListPaymentIntentsOptions, PaymentIntentRepository } from "./repository.ts";
import type {
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
  readonly #defaults: PaymentIntentServiceOptions["defaults"];

  constructor(options: PaymentIntentServiceOptions) {
    this.#repository = options.repository;
    this.#clock = options.clock;
    this.#events = options.events ?? noopEventPublisher;
    this.#registry = options.registry;
    this.#merchantPolicies = options.merchantPolicies;
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
      command.settlementAsset ?? policy?.settlementAsset ?? this.#defaults.settlementAsset;
    const provider = command.provider ?? this.#defaults.provider;

    if (policy !== undefined && command.payment !== undefined && policy.acceptedAssets.length > 0) {
      if (!policy.acceptedAssets.includes(command.payment.asset)) {
        throw new ValidationError(
          `Merchant ${command.merchant.id} does not accept ${command.payment.asset}`,
          {
            merchantId: command.merchant.id,
            asset: command.payment.asset,
            acceptedAssets: [...policy.acceptedAssets],
          },
        );
      }
    }

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

    // The contract path signs the payer's change back to `refundTo`, so there
    // is no order to plan without the payer's address. Checked against the
    // *resolved* path, not the requested one: a caller who names no path takes
    // the deployment's, and a rail the price lock will refuse is a bad request
    // — letting it through mints an intent whose only future is FAILED.
    if (executionPath === "on-chain-contract" && command.payment?.payerAddress === undefined) {
      throw new ValidationError(
        "on-chain-contract execution path requires the payer's address on the rail",
        {
          executionPath,
          ...(command.payment === undefined ? {} : { asset: command.payment.asset }),
        },
      );
    }

    if (this.#registry !== undefined) {
      if (!(await this.#registry.isSettlementAsset(settlementAsset))) {
        throw new ValidationError(
          `Settlement asset ${settlementAsset} is not admitted by the stablecoin registry`,
          {
            settlementAsset,
          },
        );
      }
      // Only a stablecoin payer asset is the registry's to admit. A native
      // asset has no token address and is not a stablecoin, so asking a
      // stablecoin registry about it is a category error — it can only ever
      // answer no, which would refuse every ETH deposit the product exists to
      // take. What bounds a native payer asset instead is the merchant's
      // `acceptedAssets` above and the chain the deployment configures.
      if (command.payment !== undefined && getAsset(command.payment.asset).kind === "stablecoin") {
        const { asset, chain } = command.payment;
        if (!(await this.#registry.isDepositAsset(asset, chain))) {
          throw new ValidationError(
            `Payer asset ${asset} on ${chain} is not a deposit asset the stablecoin registry admits`,
            { asset, chain },
          );
        }
      }
    }

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

  async markFailed(intent: PaymentIntent, reason: string): Promise<PaymentIntent> {
    if (intent.status === "FAILED") return intent;
    return this.#apply(
      markIntentFailed(intent, reason, this.#clock.now()),
      intent.version,
      PAYMENT_INTENT_EVENT.failed,
    );
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
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

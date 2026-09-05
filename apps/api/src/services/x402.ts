/**
 * The x402 application service.
 *
 * Ties together the four pieces that already exist — the resource registry, the
 * quote layer, a facilitator, and the clearing engine — into the two operations
 * an HTTP request needs: *what would this cost*, and *here is the signed
 * authorization*.
 *
 * The ordering below is the interesting part, and it is the clearing engine's
 * own rule rather than a new one: **side effects run before the state that
 * records them is persisted.** A crash after the transfer and before the
 * receipt leaves a payment the resumed step can finish, because the receipt is
 * keyed by the authorization nonce and recording it twice is a no-op. A crash
 * the other way round would credit a merchant for money that never moved.
 */

import { caip2Of } from "@mayarin/chain";
import type { ClearingEngine, RateProvider } from "@mayarin/clearing";
import {
  awaitsFacilitatorSettlement,
  type MerchantSnapshot,
  type PaymentIntent,
  type PaymentIntentService,
} from "@mayarin/payment-intent";
import {
  type Clock,
  convert,
  type Money,
  NotFoundError,
  roundUpToPayerPrecision,
  ValidationError,
} from "@mayarin/shared";
import type {
  AcceptedAsset,
  AssetCapabilities,
  FacilitatorRegistry,
  PaymentPayload,
  PaymentRequired,
  PricedAsset,
  SettlementConfirmer,
  SettleResponse,
  X402Resource,
  X402ResourceRepository,
} from "@mayarin/x402";
import {
  authorizationWithinLock,
  buildPaymentRequired,
  confirmSettlement,
  eip3009PayloadOf,
  idempotencyKeyOf,
  isTransactionHash,
  parseUnixSeconds,
  selectRequirements,
} from "@mayarin/x402";

export interface X402ServiceOptions {
  readonly resources: X402ResourceRepository;
  readonly facilitators: FacilitatorRegistry;
  /**
   * What each token actually implements, asked of the token.
   *
   * A resource row records a domain and a transfer method, and a row is
   * configuration: it can say `permit2` about a token that implements EIP-3009,
   * or carry an EIP-712 domain one character off. Either produces a signature
   * the token will not accept, from a payer who did everything right. So the
   * chain's answer is what reaches the payer, and the row is only ever a
   * statement of intent.
   */
  readonly capabilities: AssetCapabilities;
  /** One confirmer per CAIP-2 network. A network without one cannot be served. */
  readonly confirmers: ReadonlyMap<string, SettlementConfirmer>;
  readonly rates: RateProvider;
  readonly intents: PaymentIntentService;
  readonly engine: ClearingEngine;
  readonly clock: Clock;
  /** How long a price offered in a `402` is honoured. Seconds. */
  readonly quoteTtlSeconds: number;
  /**
   * The merchant, as the intent records them.
   *
   * A function rather than a repository because the snapshot is the only thing
   * this service needs from a merchant, and taking the whole repository would
   * let it reach for more later without anyone deciding that.
   */
  readonly merchantSnapshot: (merchantId: string) => Promise<MerchantSnapshot>;
}

/**
 * A resource as an operator describes it.
 *
 * Deliberately not an `X402Resource`: the domain and the transfer method are
 * absent because nobody should be able to state them. They come off the token.
 */
export interface RegisterResourceInput {
  readonly id: string;
  readonly merchantId: string;
  readonly url: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly price: Money;
  readonly accepts: readonly {
    readonly chain: AcceptedAsset["chain"];
    readonly asset: AcceptedAsset["asset"];
    readonly contract: string;
    readonly payTo: string;
  }[];
  readonly maxTimeoutSeconds: number;
}

/** What a settled payment produced, for the caller to put in a header. */
export interface X402Settlement {
  readonly response: SettleResponse;
  readonly intent: PaymentIntent;
}

export class X402Service {
  readonly #options: X402ServiceOptions;

  constructor(options: X402ServiceOptions) {
    this.#options = options;
  }

  /**
   * Register a resource, asking each token what it implements as it goes.
   *
   * The registry had a `save` nothing called: every resource had to be written
   * straight into the database, so no running deployment could be given one —
   * which meant no `402` could be served, no gated endpoint hosted, and no agent
   * demonstrated. This is the seam that was missing, not a new feature.
   *
   * The caller names the token, never its EIP-712 domain or transfer method.
   * Those are facts about a deployed contract and are probed here, so a resource
   * cannot be created carrying terms no payer could sign.
   */
  async register(input: RegisterResourceInput): Promise<X402Resource> {
    const accepts: AcceptedAsset[] = [];
    for (const accept of input.accepts) {
      const capability = await this.#options.capabilities.of(accept.chain, accept.contract);
      accepts.push({
        chain: accept.chain,
        asset: accept.asset,
        contract: accept.contract,
        payTo: accept.payTo,
        domain: capability.domain,
        transferMethod: capability.transferMethod,
      });
    }

    const resource: X402Resource = {
      id: input.id,
      merchantId: input.merchantId,
      url: input.url,
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.mimeType === undefined ? {} : { mimeType: input.mimeType }),
      price: input.price,
      accepts,
      maxTimeoutSeconds: input.maxTimeoutSeconds,
    };

    await this.#options.resources.save(resource);
    return resource;
  }

  /**
   * Ask every configured token what it implements, before serving anything.
   *
   * Optional by design: a lookup probes on demand, so this only moves the
   * failure from a payer's first request to startup. An entry point that would
   * rather find out now calls it.
   */
  warmUp(): Promise<void> {
    return this.#options.capabilities.warmUp();
  }

  async resourceById(id: string): Promise<X402Resource> {
    const resource = await this.#options.resources.findById(id);
    if (resource === undefined) {
      throw new NotFoundError(`x402 resource ${id} not found`, { resourceId: id });
    }
    return resource;
  }

  listByMerchant(merchantId: string): Promise<readonly X402Resource[]> {
    return this.#options.resources.listByMerchant(merchantId);
  }

  /**
   * The `402` body for a resource.
   *
   * An asset the rate provider cannot price is dropped rather than failing the
   * request — the same choice `/v1/quotes` already makes, for the same reason:
   * one unpriceable rail should not close a resource that has another. All of
   * them failing is a different matter and raises.
   */
  async paymentRequired(resource: X402Resource, error?: string): Promise<PaymentRequired> {
    const now = this.#options.clock.now();
    const expiresAt = new Date(now.getTime() + this.#options.quoteTtlSeconds * 1000);

    const priced: PricedAsset[] = [];
    for (const accept of resource.accepts) {
      if (!this.#options.facilitators.canServe(requirementsProbe(accept))) continue;
      const asked = await this.#asked(accept);
      if (asked === undefined) continue;
      const amount = await this.#priceInto(resource.price, asked);
      if (amount === undefined) continue;
      priced.push({ accept: asked, amount, expiresAt });
    }

    if (priced.length === 0) {
      throw new ValidationError(`x402 resource ${resource.id} has no way to be paid right now`, {
        resourceId: resource.id,
      });
    }

    return error === undefined
      ? buildPaymentRequired(resource, priced, now)
      : buildPaymentRequired(resource, priced, now, error);
  }

  /**
   * The asset as the token describes itself, or nothing.
   *
   * A token that cannot be reached or cannot be described is dropped like an
   * unpriceable one — a resource with another working rail still answers. All
   * of them failing raises, which is the existing behaviour and the honest one:
   * a 402 offering terms nobody can sign is worse than no 402 at all.
   */
  async #asked(accept: AcceptedAsset): Promise<AcceptedAsset | undefined> {
    try {
      const capability = await this.#options.capabilities.of(accept.chain, accept.contract);
      return { ...accept, domain: capability.domain, transferMethod: capability.transferMethod };
    } catch {
      return undefined;
    }
  }

  async #priceInto(price: Money, accept: AcceptedAsset): Promise<Money | undefined> {
    try {
      const quote = await this.#options.rates.quote(price.asset, accept.asset, price);
      // Rounded up to what a payer can express, exactly as the deposit path
      // does: an amount carried to eighteen decimals is one no signature will
      // ever match against a merchant's rounded expectation.
      return roundUpToPayerPrecision(convert(price, accept.asset, quote.scaledRate));
    } catch {
      return undefined;
    }
  }

  /**
   * Check a payload without settling it.
   *
   * The requirements come from our own `PaymentRequired`, never from the
   * payload's echo of them — `selectRequirements` reads the echo only to find
   * which option the payer chose.
   */
  async verify(resource: X402Resource, payment: PaymentPayload) {
    const required = await this.paymentRequired(resource);
    const requirements = selectRequirements(required, payment);
    return this.#options.facilitators.for(requirements).verify(payment, requirements);
  }

  /**
   * Settle a payload, and credit the merchant.
   *
   * Every step before the broadcast can be repeated freely. The broadcast
   * itself is guarded by the authorization nonce, which EIP-3009 records
   * on-chain and which also keys the intent — so a client that retries the same
   * `PAYMENT-SIGNATURE` reaches the same intent rather than opening a second.
   */
  async settle(resource: X402Resource, payment: PaymentPayload): Promise<X402Settlement> {
    const required = await this.paymentRequired(resource);
    const requirements = selectRequirements(required, payment);

    // The payer chooses `validBefore`; nothing stops them choosing one long
    // past the budget the 402 advertised. Holding that authorization would mean
    // settling against a price no longer honoured — the arrangement that
    // produced settlement after expiry, and then EXECUTION_EXHAUSTED, the last
    // time these two numbers were allowed to differ.
    const { authorization } = eip3009PayloadOf(payment);
    const lockExpiresAt = new Date(
      this.#options.clock.now().getTime() + requirements.maxTimeoutSeconds * 1000,
    );
    if (
      !authorizationWithinLock(
        parseUnixSeconds(authorization.validBefore, "validBefore"),
        lockExpiresAt,
      )
    ) {
      throw new ValidationError("x402 authorization outlives the price it was signed against", {
        validBefore: authorization.validBefore,
        maxTimeoutSeconds: requirements.maxTimeoutSeconds,
      });
    }

    const merchant = await this.#options.merchantSnapshot(resource.merchantId);
    const intent = await this.#intentFor(resource, requirements, merchant, payment);
    const confirmed = await this.#options.intents.confirm(intent.id);
    const transaction = await this.#options.engine.start(confirmed);
    // The current rail transfers the settlement token directly. Refuse a
    // cross-asset or changed quote before broadcasting money we cannot book.
    if (
      transaction.state !== "PAYMENT_PENDING" ||
      intent.payment === undefined ||
      intent.payment.asset !== transaction.settlementAsset ||
      transaction.settlementAmount?.amount !== BigInt(requirements.amount)
    ) {
      throw new ValidationError("x402 payment does not match a pending same-asset lock", {
        intentId: intent.id,
      });
    }

    const response = await this.#options.facilitators
      .for(requirements)
      .settle(payment, requirements);

    // The facilitator's answer is a claim. Nothing advances until the
    // transaction has been read back off the chain and matched to this payment.
    const confirmer = this.#options.confirmers.get(requirements.network);
    if (confirmer === undefined) {
      throw new ValidationError(`no x402 settlement confirmer for ${requirements.network}`, {
        network: requirements.network,
      });
    }
    // Persisted before it is trusted. The hash is not evidence of anything yet
    // — confirmation is still the only thing that credits a merchant — but a
    // confirmation that throws after a successful broadcast used to lose the
    // only pointer to money that had already moved, and EIP-3009 will not let
    // the same authorization be sent again.
    if (response.success && isTransactionHash(response.transaction)) {
      await this.#options.engine.recordFacilitatorBroadcast(transaction.id, response.transaction);
    }
    const settlement = await confirmSettlement(response, requirements, confirmer);
    const progress = await this.#options.engine.recordFacilitatorSettlement(transaction.id, {
      chain: intent.payment.chain,
      txHash: settlement.transaction,
      amount: { amount: BigInt(settlement.transfer.value), asset: intent.payment.asset },
    });
    if (progress.transaction.state !== "SUCCESS") {
      throw new ValidationError("x402 transfer confirmed but clearing did not complete", {
        intentId: intent.id,
        state: progress.transaction.state,
      });
    }

    return { response, intent: await this.#options.intents.getById(intent.id) };
  }

  /**
   * Finishes payments whose settlement went out and was never confirmed.
   *
   * The recovery half of recording a broadcast before trusting it. A
   * confirmation can fail for reasons that pass — the transaction is not mined
   * yet, an RPC is down — and the payment is left at `PAYMENT_PENDING` holding
   * the hash of money that has already moved. `ClearingEngine.resumeStuck`
   * cannot finish these itself: confirming means reading a chain, which the
   * domain deliberately cannot do.
   *
   * Each transaction is attempted on its own. A failure is left where it is
   * rather than raised, because the next pass repeats it — the same shape as
   * the expiry sweep and the webhook dispatcher.
   */
  async recoverBroadcasts(limit = 100): Promise<readonly string[]> {
    const recovered: string[] = [];
    for (const transaction of await this.#options.engine.listResumable(limit)) {
      const txHash = transaction.providerReference;
      if (
        transaction.state !== "PAYMENT_PENDING" ||
        !awaitsFacilitatorSettlement(transaction.executionPath) ||
        txHash === undefined ||
        transaction.settlementAmount === undefined
      ) {
        continue;
      }

      try {
        const intent = await this.#options.intents.getById(transaction.paymentIntentId);
        const chain = intent.payment?.chain;
        if (chain === undefined) continue;
        const resource = await this.resourceById(intent.metadata.x402Resource ?? "");
        const accept = resource.accepts.find((candidate) => candidate.chain === chain);
        const confirmer = this.#options.confirmers.get(caip2Of(chain));
        if (accept === undefined || confirmer === undefined) continue;

        // Rebuilt from what was locked, never re-priced. The payer signed for
        // this amount, and a quote that has moved since says nothing about the
        // transfer already on the chain.
        const settlement = await confirmSettlement(
          { success: true, transaction: txHash, network: caip2Of(chain) },
          {
            scheme: "exact",
            network: caip2Of(chain),
            amount: transaction.settlementAmount.amount.toString(),
            asset: accept.contract,
            payTo: accept.payTo,
            maxTimeoutSeconds: resource.maxTimeoutSeconds,
          },
          confirmer,
        );
        await this.#options.engine.recordFacilitatorSettlement(transaction.id, {
          chain,
          txHash: settlement.transaction,
          amount: {
            amount: BigInt(settlement.transfer.value),
            asset: transaction.settlementAmount.asset,
          },
        });
        recovered.push(transaction.id);
      } catch {
        // Left for the next pass, which is what a sweep is for.
      }
    }
    return recovered;
  }

  /**
   * The intent for this authorization, created once.
   *
   * `idempotencyKeyOf` is the nonce scoped by network and asset, so a replayed
   * header reaches the intent it already made. That matters most in the window
   * before the chain has recorded the nonce: without it, two requests carrying
   * the same signature would each open an intent and post to the ledger, and
   * only the second settlement would fail.
   */
  async #intentFor(
    resource: X402Resource,
    requirements: { network: string; asset: string; amount: string },
    merchant: MerchantSnapshot,
    payment: PaymentPayload,
  ): Promise<PaymentIntent> {
    const accept = resource.accepts.find(
      (candidate) =>
        caip2Of(candidate.chain) === requirements.network &&
        candidate.contract.toLowerCase() === requirements.asset.toLowerCase(),
    );
    if (accept === undefined) {
      throw new ValidationError(
        `x402 resource ${resource.id} does not accept ${requirements.asset}`,
      );
    }

    return this.#options.intents.create({
      merchant,
      amount: resource.price,
      idempotencyKey: idempotencyKeyOf(payment),
      payment: { chain: accept.chain, asset: accept.asset },
      executionPath: "x402",
      source: { type: "manual" },
      metadata: {
        x402Resource: resource.id,
        x402Nonce: eip3009PayloadOf(payment).authorization.nonce,
      },
    });
  }
}

/**
 * The shape `FacilitatorRegistry.canServe` needs to answer for an accepted
 * asset, before a price exists to fill the rest in.
 *
 * Only `scheme` and `network` are read, which is why the rest is allowed to be
 * empty here rather than requiring a quote first — asking a rate provider for a
 * price on a rail nothing can settle is work thrown away.
 */
function requirementsProbe(accept: AcceptedAsset) {
  return {
    scheme: "exact",
    network: caip2Of(accept.chain),
    amount: "0",
    asset: accept.contract,
    payTo: accept.payTo,
    maxTimeoutSeconds: 0,
  };
}

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

import type { ChainId } from "@mayarin/chain";
import { caip2Of } from "@mayarin/chain";
import type { ClearingEngine, ClearingTransaction, RateProvider } from "@mayarin/clearing";
import {
  awaitsFacilitatorSettlement,
  type MerchantSnapshot,
  type PaymentIntent,
  type PaymentIntentService,
} from "@mayarin/payment-intent";
import { payerEstimate, type QuoteEngine } from "@mayarin/quote";
import {
  type AssetCode,
  assetDecimals,
  type Clock,
  ConflictError,
  convert,
  deserializeMoney,
  type Money,
  money,
  NotFoundError,
  QuoteExpiredError,
  roundUpToPayerPrecision,
  type SerializedMoney,
  ValidationError,
} from "@mayarin/shared";
import type {
  AcceptedAsset,
  AssetCapabilities,
  CrossAssetSettler,
  CrossAssetSwapRequest,
  FacilitatorRegistry,
  ListListedX402ResourcesOptions,
  MerchantRails,
  PaginatedX402ResourceRepository,
  PayableKind,
  PayableQuoteRepository,
  PayerSurplusRefundRequest,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  PricedAsset,
  PricedOffer,
  RailChoice,
  RailObservation,
  RailObservationSource,
  SettlementConfirmer,
  SettleResponse,
  X402Resource,
  X402ResourceListEntry,
} from "@mayarin/x402";
import {
  authorizationWithinLock,
  buildPaymentRequired,
  chooseRail,
  confirmSettlement,
  eip3009PayloadOf,
  idempotencyKeyOf,
  isPayableKind,
  isTransactionHash,
  parseUnixSeconds,
  selectRequirements,
} from "@mayarin/x402";

export interface X402ServiceOptions {
  /** The paginated port: the public listed index reads through it (#273). */
  readonly resources: PaginatedX402ResourceRepository;
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
   * What the rails have been doing, when this deployment can see it.
   *
   * Absent means the `402` lists its rails in the order the resource registered
   * them, which is what it did before anything measured them. Present, the
   * best-behaved rail is listed first — see `#ordered`.
   */
  readonly rails?: RailObservationSource;
  /**
   * The merchant, as the intent records them.
   *
   * A function rather than a repository because the snapshot is the only thing
   * this service needs from a merchant, and taking the whole repository would
   * let it reach for more later without anyone deciding that.
   */
  readonly merchantSnapshot: (merchantId: string) => Promise<MerchantSnapshot>;
  /**
   * The asset this merchant is paid in.
   *
   * A rail offering any other asset is a cross-asset payment: the agent signs
   * an authorization in what it holds, and the merchant is still paid in what
   * they chose. Read through a function for the same reason `merchantSnapshot`
   * is one — the settlement asset is all this service needs from a policy.
   */
  readonly settlementAssetOf: (merchantId: string) => Promise<AssetCode>;
  /**
   * The quote layer, when this deployment has one.
   *
   * Only a cross-asset rail needs it, and only for the direction a fixed
   * invoice actually poses: deliver exactly this much settlement asset, what
   * does it cost in the payer's? Absent means cross-asset rails are not
   * offered — a deployment without a venue cannot swap, so advertising a price
   * it could not fill would be a `402` nobody can pay.
   */
  readonly quote?: () => Promise<{
    readonly engine: QuoteEngine;
    readonly slippageBps: number;
  }>;
  /**
   * Where a cross-asset authorization pays.
   *
   * Same-asset pays the merchant directly and this is unused. Cross-asset
   * cannot: the payer's asset has to land somewhere Mayarin can swap it from,
   * and `transferWithAuthorization` names one recipient chosen before the
   * payer signs. That recipient is the operator, and `register` refuses a
   * cross-asset rail pointed anywhere else — a rail that paid the merchant in
   * the payer's asset would settle an invoice in a currency they never agreed
   * to hold.
   */
  readonly operatorAddress?: string;
  /**
   * Swaps the payer's asset into the merchant's, once the authorization lands.
   *
   * Its absence is what keeps a cross-asset rail out of the `402` on a
   * deployment that cannot execute one. Advertising terms that would be refused
   * after the payer had signed is worse than not offering the rail: the agent
   * did everything right and is told no.
   */
  readonly crossAssetSettler?: CrossAssetSettler;
  /**
   * Where a merchant is paid on-chain, per chain.
   *
   * A cross-asset swap delivers straight to the merchant, so it needs an
   * address rather than the `payTo` on the rail — that one is the operator's,
   * because the payer's asset had to land somewhere swappable. A merchant's
   * address differs per chain (the Safe salt carries the chain), so this is
   * asked per payment rather than resolved once.
   */
  readonly settlementAddressOf?: (
    merchantId: string,
    chain: ChainId,
  ) => Promise<string | undefined>;
  /**
   * The merchant-rail source payables are derived from (#273).
   *
   * A payable offers the same rails a checkout would — the merchant's own
   * settings, derived — rather than a registry the merchant had to re-enter.
   * Structural, satisfied by the payment-intent layer's rail catalog. Absent
   * means this deployment serves no payables: `merchantAccepts` reports none.
   */
  readonly merchantRails?: MerchantRails;
  /** The quote lock between a payable `402` and its settle. */
  readonly payableQuotes?: PayableQuoteRepository;
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
  /**
   * Whether this resource appears in the public cross-merchant index (#273).
   * Omitted means "unchanged" — an operator re-registering a resource must not
   * silently unlist it.
   */
  readonly listed?: boolean;
}

/** What a settled payment produced, for the caller to put in a header. */
export interface X402Settlement {
  readonly response: SettleResponse;
  readonly intent: PaymentIntent;
}

/**
 * What a payable payment must be traceable to (#273): which obligation it
 * paid, and the commerce provenance the intent should carry.
 *
 * Metadata only, by decision: no `PaymentSource` variant, no parallel payment
 * model. An x402 payment of an invoice is a `manual` intent whose metadata
 * names the invoice, exactly like a hosted checkout's does.
 */
export interface PayableProvenance {
  readonly kind: PayableKind;
  readonly obligationId: string;
  /** The merchant's own reference — an invoice's number. */
  readonly merchantReference?: string;
  /** Commerce metadata the intent carries, e.g. `invoiceId`. */
  readonly metadata?: Readonly<Record<string, string>>;
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
    const settlementAsset = await this.#options.settlementAssetOf(input.merchantId);
    const accepts: AcceptedAsset[] = [];
    for (const accept of input.accepts) {
      if (accept.asset !== settlementAsset) this.#requireCrossAssetRail(accept, settlementAsset);
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
      // Omitted means unchanged: an operator re-registering a resource must
      // not silently unlist it from the public index.
      listed: input.listed ?? (await this.#options.resources.findById(input.id))?.listed ?? false,
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

  remove(id: string): Promise<void> {
    return this.#options.resources.remove(id);
  }

  /**
   * The two halves of the discovery opt-in (#273): a listed resource appears
   * in the public cross-merchant index, an unlisted one stops appearing. A
   * registry row, not an aggregate — no version to bump, because the flag
   * carries no value and two racing toggles each mean what they say.
   */
  async listResource(id: string): Promise<X402Resource> {
    const resource = await this.resourceById(id);
    const next = { ...resource, listed: true };
    await this.#options.resources.save(next);
    return next;
  }

  async unlistResource(id: string): Promise<X402Resource> {
    const resource = await this.resourceById(id);
    const next = { ...resource, listed: false };
    await this.#options.resources.save(next);
    return next;
  }

  listByMerchant(merchantId: string): Promise<readonly X402Resource[]> {
    return this.#options.resources.listByMerchant(merchantId);
  }

  /** Listed resources across every merchant — the discovery read (#273). */
  listListed(options: ListListedX402ResourcesOptions): Promise<readonly X402ResourceListEntry[]> {
    return this.#options.resources.listPageListed(options);
  }

  /**
   * The `402` body for an offer — a registered resource, or a payable
   * obligation an agent addresses by id (#273).
   *
   * An asset the rate provider cannot price is dropped rather than failing the
   * request — the same choice `/v1/quotes` already makes, for the same reason:
   * one unpriceable rail should not close a resource that has another. All of
   * them failing is a different matter and raises.
   */
  async paymentRequired(offer: PricedOffer, error?: string): Promise<PaymentRequired> {
    return this.#pricedFor(offer, this.#options.clock.now(), error);
  }

  /**
   * Prices an offer into each asset it accepts and builds the `402` body.
   *
   * Everything that turns an offer into a `PaymentRequired` passes through here,
   * so a resource and a payable (#273) are priced by the same rule and there is
   * no second place for the two to drift.
   */
  async #pricedFor(offer: PricedOffer, now: Date, error?: string): Promise<PaymentRequired> {
    const expiresAt = new Date(now.getTime() + this.#options.quoteTtlSeconds * 1000);

    const settlementAsset = await this.#options.settlementAssetOf(offer.merchantId);
    const priced: PricedAsset[] = [];
    for (const accept of offer.accepts) {
      if (!this.#options.facilitators.canServe(requirementsProbe(accept))) continue;
      const asked = await this.#asked(accept);
      if (asked === undefined) continue;
      const amount =
        asked.asset === settlementAsset
          ? await this.#priceInto(offer.price, asked)
          : await this.#priceCrossAsset(offer.price, asked, settlementAsset);
      if (amount === undefined) continue;
      priced.push({ accept: asked, amount, expiresAt });
    }

    if (priced.length === 0) {
      throw new ValidationError(`x402 offer ${offer.id} has no way to be paid right now`, {
        offerId: offer.id,
      });
    }

    const ordered = await this.#ordered(priced);
    return buildPaymentRequired(offer, ordered, now, error);
  }

  /**
   * Which rail this offer should be paid on, and why.
   *
   * Exposed because the ordering below is a decision made on live data, and a
   * decision an agent cannot see the reasoning for is one it has to take on
   * trust. Also what makes `unobserved` legible: the choice says out loud when
   * it is really just the first accepted rail.
   */
  async railChoice(offer: PricedOffer): Promise<RailChoice> {
    const chains = distinct(offer.accepts.map((accept) => accept.chain));
    return chooseRail(chains, await this.#observe(chains));
  }

  /**
   * The rails a payable can be paid on, derived from the merchant's own
   * settings (#273).
   *
   * Not a registry the merchant re-entered: the same rails a checkout would
   * offer. Only token rails survive — EIP-3009 has no ERC-20 to sign against —
   * and each token is probed as it is offered, for the same reason `register`
   * probes: an advertised domain a token would not accept is a signature no
   * payer can produce.
   *
   * Same-asset rails pay the merchant's per-chain settlement address; a
   * cross-asset rail pays the operator, which is the same rule `register`
   * enforces, applied at derivation — and a deployment that cannot serve a
   * cross-asset payment offers no rail for it.
   */
  async merchantAccepts(merchantId: string): Promise<readonly AcceptedAsset[]> {
    const rails = this.#options.merchantRails;
    if (rails === undefined) return [];

    const settlementAsset = await this.#options.settlementAssetOf(merchantId);
    const operator = this.#crossAssetOperator();
    const accepts: AcceptedAsset[] = [];

    for (const rail of await rails.railsFor(merchantId)) {
      if (rail.contract === undefined) continue;
      const sameAsset = rail.asset === settlementAsset;
      if (!sameAsset && operator === undefined) continue;
      const payTo = sameAsset ? rail.payTo : operator;
      if (payTo === undefined) continue;
      try {
        const capability = await this.#options.capabilities.of(rail.chain, rail.contract);
        accepts.push({
          chain: rail.chain,
          asset: rail.asset,
          contract: rail.contract,
          payTo,
          domain: capability.domain,
          transferMethod: capability.transferMethod,
        });
      } catch {
        // A token that cannot be reached is not a way to pay — the same drop
        // `#asked` makes.
      }
    }
    return accepts;
  }

  /**
   * The priced rails, best first.
   *
   * The specification lets a payer pick any entry in `accepts`, and a client
   * with no opinion takes the first — so ordering is the whole mechanism by
   * which a measurement reaches a payer. Ranked on median headroom, because a
   * rail that has been settling with seconds to spare is the one an agent
   * should not be steered onto by accident.
   *
   * Only the chosen rail moves. The rest keep the order the resource declared,
   * so a deployment that observes nothing behaves exactly as it did before any
   * of this existed.
   */
  async #ordered(priced: readonly PricedAsset[]): Promise<readonly PricedAsset[]> {
    if (this.#options.rails === undefined || priced.length < 2) return priced;

    const chains = distinct(priced.map((entry) => entry.accept.chain));
    const choice = chooseRail(chains, await this.#observe(chains));
    if (choice.unobserved) return priced;

    const chosen = priced.filter((entry) => entry.accept.chain === choice.chain);
    const rest = priced.filter((entry) => entry.accept.chain !== choice.chain);
    return [...chosen, ...rest];
  }

  async #observe(chains: readonly ChainId[]): Promise<readonly RailObservation[]> {
    return this.#options.rails === undefined ? [] : await this.#options.rails.observe(chains);
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

  /**
   * What a payer must authorize in an asset the merchant does not settle in.
   *
   * Priced backwards, and it has to be. The merchant's number is the fixed one
   * and the payer's is derived, so asking "what does one EURC buy?" and scaling
   * up prices whatever depth a one-unit probe happened to touch — the mistake
   * that locked a `minOut` a thin pool could not fill and reverted `STF` after
   * the payer had already paid. `quoteFiatPrice` prices the fiat leg into the
   * settlement asset first, then asks the venue what delivering *exactly* that
   * costs.
   *
   * `payerEstimate` grosses the answer up by the configured slippage. That is
   * the number the agent signs for, and it is also the ceiling the swap may
   * consume: `exactOutputSingle` reverts rather than spending past it, and
   * whatever it does not spend is the payer's.
   *
   * Dropped rather than raised when this deployment has no quote layer or no
   * venue can price the pair — the same choice a same-asset rail makes, for the
   * same reason: one unpriceable rail should not close a resource with another.
   */
  async #priceCrossAsset(
    price: Money,
    accept: AcceptedAsset,
    settlementAsset: AssetCode,
  ): Promise<Money | undefined> {
    if (this.#crossAssetOperator() === undefined) return undefined;
    const quote = await this.#options.quote?.();
    if (quote === undefined) return undefined;
    try {
      const fiat = await quote.engine.quoteFiatPrice({
        price,
        settlementAsset,
        payerAsset: accept.asset,
        chain: accept.chain,
        // One whole unit, matching the contract path and the preview. The probe
        // only stands in when a venue cannot price backwards at all; when it
        // can, the settlement amount replaces it entirely.
        probe: money(10n ** BigInt(assetDecimals(accept.asset)), accept.asset),
      });
      // Unreachable: the caller already established the assets differ. A quote
      // layer that answered otherwise priced a different payment.
      if (!("composed" in fiat)) return undefined;
      return roundUpToPayerPrecision(
        payerEstimate(fiat.composed, fiat.settlement.settlementAmount, quote.slippageBps).amount,
      );
    } catch {
      return undefined;
    }
  }

  /**
   * A cross-asset rail is only registerable if this deployment can serve it.
   *
   * Refused at registration rather than at the first `402`, because both
   * failures are permanent and configuration is where they can still be fixed
   * by the person who caused them.
   */
  /**
   * The operator a cross-asset rail pays, when this deployment serves one.
   *
   * All three or none: pricing the rail, holding the payer's asset and swapping
   * it are one capability, and a deployment missing any of them cannot offer it.
   */
  /**
   * The address a cross-asset rail must pay, when this deployment can serve one.
   *
   * Public: it is already advertised inside every cross-asset `402`, so a
   * caller learning it here learns nothing a payer is not told. Exposed because
   * a dashboard offering the rail has to name the same address registration
   * will insist on.
   */
  crossAssetOperator(): string | undefined {
    return this.#crossAssetOperator();
  }

  #crossAssetOperator(): string | undefined {
    if (this.#options.quote === undefined || this.#options.crossAssetSettler === undefined) {
      return undefined;
    }
    return this.#options.operatorAddress;
  }

  #requireCrossAssetRail(
    accept: RegisterResourceInput["accepts"][number],
    settlementAsset: AssetCode,
  ): void {
    const operator = this.#crossAssetOperator();
    if (operator === undefined) {
      throw new ValidationError(
        `This deployment cannot take ${accept.asset} for a merchant settling in ${settlementAsset}: a cross-asset rail needs a quote layer, an operator and a settler`,
        { asset: accept.asset, settlementAsset },
      );
    }
    if (accept.payTo.toLowerCase() !== operator.toLowerCase()) {
      throw new ValidationError(
        `A cross-asset rail must pay the operator, not ${accept.payTo}: the payer's ${accept.asset} has to land where it can be swapped into ${settlementAsset}`,
        { asset: accept.asset, settlementAsset, payTo: accept.payTo },
      );
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
    return this.#settleAuthorized(intent, requirements, payment);
  }

  /**
   * Broadcasts an authorized payment and finishes its clearing — the half
   * every authorized settle shares (#273).
   *
   * The caller has already chosen the terms and minted the intent; what is left
   * is the engine's own rule, side effects before the state that records them.
   * `refusePartial` lets a payable replace the same-asset mismatch wording: a
   * payable has to say plainly that it must be paid in full, not that a lock
   * does not match.
   */
  async #settleAuthorized(
    intent: PaymentIntent,
    requirements: PaymentRequirements,
    payment: PaymentPayload,
    refusePartial?: (authorized: Money, locked: Money) => ValidationError,
  ): Promise<X402Settlement> {
    const confirmed = await this.#options.intents.confirm(intent.id);
    const transaction = await this.#options.engine.start(confirmed);
    const rail = intent.payment;
    const locked = transaction.settlementAmount;
    if (transaction.state !== "PAYMENT_PENDING" || rail === undefined || locked === undefined) {
      throw new ValidationError("x402 payment does not match a pending lock", {
        intentId: intent.id,
      });
    }

    // What the payer signed for, in the asset they signed in. On a same-asset
    // rail that is the merchant's number and has to equal the lock exactly; on
    // a cross-asset one it is the swap's budget and the two are not comparable.
    const authorized = money(BigInt(requirements.amount), rail.asset);
    const crossAsset = rail.asset !== transaction.settlementAsset;
    if (!crossAsset && locked.amount !== authorized.amount) {
      throw (
        refusePartial?.(authorized, locked) ??
        new ValidationError("x402 payment does not match a pending same-asset lock", {
          intentId: intent.id,
        })
      );
    }

    // Planned before the payer's money moves, and that ordering is the whole
    // point of planning at all. A route needing more than the authorization
    // carries is unexecutable, and discovering it after
    // `transferWithAuthorization` has landed leaves the payer's asset at the
    // operator, the merchant unpaid, and the nonce spent so no retry can pay.
    const swapRequest = crossAsset
      ? await this.#planSwap(intent.merchant.id, rail.chain, authorized, locked)
      : undefined;

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
      await this.#options.engine.recordFacilitatorBroadcast(
        transaction.id,
        response.transaction,
        authorized,
      );
    }
    // Confirms the authorization, whichever rail this is. On a cross-asset one
    // that is the payer's asset arriving at the operator rather than at the
    // merchant — `requirements` already names both, because the `402` did.
    const settlement = await confirmSettlement(response, requirements, confirmer);

    const facilitatorSettlement =
      swapRequest === undefined
        ? {
            chain: rail.chain,
            txHash: settlement.transaction,
            amount: money(BigInt(settlement.transfer.value), rail.asset),
          }
        : {
            ...(await this.#swap(transaction.id, swapRequest)),
            // Whoever signed the authorization is who the change is owed to.
            // Read off the chain rather than taken from the payload, for the
            // same reason every other field here is.
            payer: settlement.payer,
          };

    const progress = await this.#options.engine.recordFacilitatorSettlement(
      transaction.id,
      facilitatorSettlement,
    );
    if (progress.transaction.state !== "SUCCESS") {
      throw new ValidationError("x402 transfer confirmed but clearing did not complete", {
        intentId: intent.id,
        state: progress.transaction.state,
      });
    }
    if (swapRequest !== undefined) {
      try {
        await this.#refundPayerSurplus(progress.transaction, rail.chain);
      } catch {
        // The merchant is paid and the liability is durable. A refund RPC
        // failure must not turn a completed payment into a failed HTTP call;
        // `recoverBroadcasts` resumes the return from its recorded position.
      }
    }

    return { response, intent: await this.#options.intents.getById(intent.id) };
  }

  /**
   * Settle an authorization against a payable obligation — an invoice's
   * outstanding balance or a payment link's total (#273).
   *
   * Same skeleton as `settle`, two differences that are the whole point of a
   * payable:
   *
   * - **The quote row is the price lock.** A payable's price is a fact about
   *   the world when the agent asked, so the lock between the `402` and here
   *   is the quote row: its amount, its rails as derived at quote time, and
   *   its expiry. The intent is minted at settle, nonce-keyed like a
   *   resource's, carrying the obligation's provenance so a payment can be
   *   traced to the document it paid.
   * - **The replay short-circuits come before anything else.** Once the
   *   broadcast has gone out the nonce is spent on-chain, so a retry that
   *   reached the broadcast again would spend money twice: a COMPLETED intent
   *   answers from the record, a PROCESSING one holding a broadcast hash
   *   resumes only the confirm half.
   *
   * One authorization per obligation: the quote row's claim decides, atomically,
   * which of two racing agents pays — the loser is refused before any money
   * moves, having minted only an intent nobody will execute.
   */
  async settlePayable(
    offer: PricedOffer,
    payment: PaymentPayload,
    provenance: PayableProvenance,
  ): Promise<X402Settlement> {
    const quotes = this.#options.payableQuotes;
    if (quotes === undefined) {
      throw new ValidationError("x402 payables are not enabled on this deployment", {
        kind: provenance.kind,
        obligationId: provenance.obligationId,
      });
    }

    const now = this.#options.clock.now();
    const { authorization } = eip3009PayloadOf(payment);
    const quote = await quotes.find(provenance.kind, provenance.obligationId);
    if (quote === undefined) {
      throw new ValidationError(
        `No x402 quote is outstanding for ${provenance.kind} ${provenance.obligationId}; request one at ${offer.url}`,
        { kind: provenance.kind, obligationId: provenance.obligationId, url: offer.url },
      );
    }

    // The rail the payer chose, looked up in the quote's snapshot rather than
    // priced. The snapshot is the contract — the payer signed against these
    // rails — and the intent has to be findable before anything can be replayed.
    const accept = quote.accepts.find(
      (candidate) =>
        caip2Of(candidate.chain) === payment.accepted.network &&
        candidate.contract.toLowerCase() === payment.accepted.asset.toLowerCase(),
    );
    if (accept === undefined) {
      throw new ValidationError(
        `x402 payment chose ${payment.accepted.asset} on ${payment.accepted.network}, which this payable does not accept`,
        { kind: provenance.kind, obligationId: provenance.obligationId },
      );
    }

    const merchant = await this.#options.merchantSnapshot(quote.merchantId);
    const intent = await this.#options.intents.create({
      merchant,
      // The current outstanding, not the quoted one: minting is idempotent on
      // the nonce, and a stale amount here would make the replay below a
      // fingerprint conflict — the freshness check below says it in words.
      amount: offer.price,
      idempotencyKey: idempotencyKeyOf(payment),
      payment: { chain: accept.chain, asset: accept.asset },
      executionPath: "x402",
      source: { type: "manual" },
      ...(provenance.merchantReference === undefined
        ? {}
        : { merchantReference: provenance.merchantReference }),
      metadata: {
        x402PayableKind: provenance.kind,
        x402PayableId: provenance.obligationId,
        x402Nonce: authorization.nonce,
        ...provenance.metadata,
      },
    });

    if (intent.status === "COMPLETED") {
      return this.#settledResponse(intent);
    }
    if (intent.status === "PROCESSING") {
      const transaction = await this.#options.engine.findByPaymentIntentId(intent.id);
      if (
        transaction !== null &&
        transaction.state === "PAYMENT_PENDING" &&
        transaction.providerReference !== undefined
      ) {
        const settlement = await this.#resumeBroadcast(transaction);
        if (!settlement) {
          throw new ValidationError(
            `x402 payable ${provenance.obligationId} is mid-settlement and cannot be resumed; it will complete on its own`,
            { intentId: intent.id },
          );
        }
        await this.#markPayableSettled(provenance, this.#options.clock.now());
        return this.#settledResponse(await this.#options.intents.getById(intent.id));
      }
      // PROCESSING with no recorded broadcast is not resumable here: the
      // engine owns that state, and guessing at it would double-broadcast.
      throw new ValidationError(
        `x402 payable ${provenance.obligationId} is already being settled`,
        { intentId: intent.id },
      );
    }

    // The obligation moved since the quote: a partial payment landed, or the
    // link was edited. The remedy is the same as an expiry — a new `402` —
    // but the payer needs to hear that the number changed, not that time ran
    // out.
    if (offer.price.asset !== quote.amount.asset || offer.price.amount !== quote.amount.amount) {
      throw new ConflictError(
        `x402 quote for ${provenance.kind} ${provenance.obligationId} quoted ${quote.amount.amount.toString()} ${quote.amount.asset} but ${offer.price.amount.toString()} ${offer.price.asset} is outstanding now; request a new 402 at ${offer.url}`,
        {
          kind: provenance.kind,
          obligationId: provenance.obligationId,
          quoted: quote.amount.amount.toString(),
          current: offer.price.amount.toString(),
          asset: offer.price.asset,
        },
      );
    }

    // The lock a payable's authorization must live within is the quote's own
    // expiry — there is no merchant-configured ceiling to take the min of.
    if (
      !authorizationWithinLock(
        parseUnixSeconds(authorization.validBefore, "validBefore"),
        quote.expiresAt,
      )
    ) {
      throw new ValidationError("x402 authorization outlives the quote it was signed against", {
        validBefore: authorization.validBefore,
        quoteExpiresAt: quote.expiresAt.toISOString(),
      });
    }

    // One authorization per obligation, decided atomically. Two agents racing
    // one invoice both reach here; only the row can decide, and only a claim
    // the database serializes guarantees one of them is refused before money
    // moves.
    const claim = await quotes.claim(
      provenance.kind,
      provenance.obligationId,
      authorization.nonce,
      now,
    );
    if (!claim.ok) {
      if (claim.reason === "missing") {
        throw new ValidationError(
          `No x402 quote is outstanding for ${provenance.kind} ${provenance.obligationId}; request one at ${offer.url}`,
          { kind: provenance.kind, obligationId: provenance.obligationId },
        );
      }
      if (claim.reason === "expired") {
        throw new QuoteExpiredError(
          `x402 quote for ${provenance.kind} ${provenance.obligationId} expired; request a new 402 at ${offer.url}`,
          { kind: provenance.kind, obligationId: provenance.obligationId, url: offer.url },
        );
      }
      throw new ConflictError(
        `x402 payable ${provenance.kind} ${provenance.obligationId} is already being paid by another authorization; request a new 402 at ${offer.url} once it completes or its claim expires`,
        { kind: provenance.kind, obligationId: provenance.obligationId, url: offer.url },
      );
    }

    // Requirements priced from the quote's snapshot at settle-time rates,
    // mirroring a resource settle. The freshness check above already pinned
    // the obligation's number; this re-derives what the payer must have
    // signed in the asset they chose.
    const required = await this.#pricedFor(
      { ...offer, price: quote.amount, accepts: quote.accepts },
      now,
    );
    const requirements = selectRequirements(required, payment);

    const settlement = await this.#settleAuthorized(
      intent,
      requirements,
      payment,
      (authorized, outstanding) =>
        new ValidationError(
          `A payable must be paid in full: the authorization is for ${authorized.amount.toString()} ${authorized.asset} but ${outstanding.amount.toString()} ${outstanding.asset} is outstanding. Request a new 402 at ${offer.url} for the full balance.`,
          {
            intentId: intent.id,
            authorized: authorized.amount.toString(),
            outstanding: outstanding.amount.toString(),
          },
        ),
    );
    await this.#markPayableSettled(provenance, this.#options.clock.now());
    return settlement;
  }

  /**
   * The answer to a payable settle that has nothing left to do: the intent is
   * COMPLETED, so the settlement is read back from the clearing record rather
   * than broadcast again.
   */
  async #settledResponse(intent: PaymentIntent): Promise<X402Settlement> {
    const transaction = await this.#options.engine.findByPaymentIntentId(intent.id);
    const chain = intent.payment?.chain;
    if (transaction?.providerReference === undefined || chain === undefined) {
      throw new ValidationError(
        `x402 payment ${intent.id} completed without a settlement to return`,
        {
          intentId: intent.id,
        },
      );
    }
    return {
      response: {
        success: true,
        transaction: transaction.providerReference,
        network: caip2Of(chain),
      },
      intent,
    };
  }

  /**
   * Records that a payable was paid. Non-fatal on purpose: the merchant is
   * already paid and the ledger is already written; this row only decides
   * whether the next `402` for this obligation starts fresh, which it also
   * does when the claim lapses at expiry.
   */
  async #markPayableSettled(provenance: PayableProvenance, now: Date): Promise<void> {
    try {
      await this.#options.payableQuotes?.markSettled(provenance.kind, provenance.obligationId, now);
    } catch {
      // The quote row resets on the next 402 regardless.
    }
  }

  /**
   * The swap this payment will need, checked against what the payer authorised.
   *
   * Refused here rather than left to `amountInMaximum` on-chain. The contract
   * bound is still set and still reverts, but a revert at that point has already
   * taken the payer's asset — so the bound is the second line of defence and
   * this is the first.
   */
  async #planSwap(
    merchantId: string,
    chain: ChainId,
    authorized: Money,
    exactOut: Money,
  ): Promise<CrossAssetSwapRequest> {
    const settler = this.#options.crossAssetSettler;
    const recipient = await this.#options.settlementAddressOf?.(merchantId, chain);
    if (settler === undefined || recipient === undefined) {
      throw new ValidationError(
        `This deployment cannot pay ${merchantId} in ${exactOut.asset} on ${chain}: a cross-asset payment needs a settler and an on-chain address to deliver into`,
        { merchantId, chain },
      );
    }

    const request: CrossAssetSwapRequest = { chain, held: authorized, exactOut, recipient };
    const expectedIn = await settler.plan(request);
    if (expectedIn.amount > authorized.amount) {
      throw new ValidationError(
        "The swap would spend more than the payer authorised; the price moved after the 402",
        {
          merchantId,
          expectedIn: expectedIn.amount.toString(),
          authorized: authorized.amount.toString(),
          asset: authorized.asset,
        },
      );
    }
    return request;
  }

  /**
   * Sends the swap, records its hash, then reads it back.
   *
   * Send, persist, confirm — the same order the authorization takes, and here
   * for a sharper reason. An authorization cannot be re-sent because EIP-3009
   * records its nonce; a swap has no such guard, so a hash lost between sending
   * and confirming is one a resume would send again, spending the operator's own
   * balance and paying the merchant twice.
   */
  async #swap(
    clearingTransactionId: string,
    request: CrossAssetSwapRequest,
  ): Promise<{ chain: ChainId; txHash: string; amount: Money; surplus: Money }> {
    // `#planSwap` established this; re-read for the type rather than assert.
    const settler = this.#options.crossAssetSettler;
    if (settler === undefined) {
      throw new ValidationError("x402 cannot settle a cross-asset payment on this deployment", {
        clearingTransactionId,
      });
    }

    const txHash = await settler.send(request);
    await this.#options.engine.recordCrossAssetSwap(clearingTransactionId, txHash);
    const swap = await settler.confirm(txHash, request);

    return {
      chain: request.chain,
      txHash: swap.transaction,
      amount: swap.delivered,
      // The payer's change: authorised, not consumed, and still at the operator.
      surplus: money(request.held.amount - swap.spent.amount, request.held.asset),
    };
  }

  /**
   * Finishes payments or payer-surplus returns whose broadcast was interrupted.
   *
   * The recovery half of recording a broadcast before trusting it. A
   * confirmation can fail for reasons that pass — the transaction is not mined
   * yet, an RPC is down — and the payment is left at `PAYMENT_PENDING` holding
   * the hash of money that has already moved. `ClearingEngine.resumeStuck`
   * cannot finish these itself: confirming means reading a chain, which the
   * domain deliberately cannot do.
   *
   * A cross-asset payment has two chain movements and either can be the one that
   * was interrupted, so it branches on the `settlement.swap` event: with it the
   * swap has gone out and only needs confirming, without it the payer's asset is
   * at the operator and the swap still has to be sent. Both are handled by
   * `#recoverCrossAsset`; confirming the wrong one would credit a merchant who
   * was never paid, which is why this used to skip them.
   *
   * Each transaction is attempted on its own. A failure is left where it is
   * rather than raised, because the next pass repeats it — the same shape as
   * the expiry sweep and the webhook dispatcher.
   */
  async recoverBroadcasts(limit = 100): Promise<readonly string[]> {
    const recovered: string[] = [];
    for (const transaction of await this.#options.engine.listResumable(limit)) {
      if (
        transaction.state !== "PAYMENT_PENDING" ||
        !awaitsFacilitatorSettlement(transaction.executionPath) ||
        transaction.providerReference === undefined ||
        transaction.settlementAmount === undefined
      ) {
        continue;
      }

      try {
        if (await this.#resumeBroadcast(transaction)) recovered.push(transaction.id);
      } catch {
        // Left for the next pass, which is what a sweep is for.
      }
    }
    for (const transaction of await this.#options.engine.listPendingPayerSurplusRefunds(limit)) {
      try {
        const intent = await this.#options.intents.getById(transaction.paymentIntentId);
        const chain = intent.payment?.chain;
        if (chain === undefined) continue;
        await this.#refundPayerSurplus(transaction, chain);
        if (!recovered.includes(transaction.id)) recovered.push(transaction.id);
      } catch {
        // The recorded liability stays pending for the next sweep.
      }
    }
    return recovered;
  }

  /**
   * Finishes one interrupted broadcast: rebuild what was signed from the
   * record, confirm it on-chain, complete the clearing.
   *
   * Shared by the sweep and by a payable settle that comes back to an
   * authorization already broadcast (#273) — the nonce is spent on-chain in
   * both cases, so the confirm half is the only half left.
   *
   * `false` means this payment's terms cannot be reconstructed and it is left
   * where it is, for a sweep to retry or an operator to look at.
   */
  async #resumeBroadcast(transaction: ClearingTransaction): Promise<boolean> {
    const txHash = transaction.providerReference;
    if (
      transaction.state !== "PAYMENT_PENDING" ||
      !awaitsFacilitatorSettlement(transaction.executionPath) ||
      txHash === undefined ||
      transaction.settlementAmount === undefined
    ) {
      return false;
    }

    const intent = await this.#options.intents.getById(transaction.paymentIntentId);
    const chain = intent.payment?.chain;
    const railAsset = intent.payment?.asset;
    if (chain === undefined || railAsset === undefined) return false;
    const terms = await this.#signedTerms(intent, chain, railAsset);
    const confirmer = this.#options.confirmers.get(caip2Of(chain));
    if (terms === undefined || confirmer === undefined) return false;

    // What the payer signed, off the event that recorded the broadcast. A
    // payment broadcast before that event carried it falls back to the lock,
    // which on a same-asset rail is the same number — `settle` refuses one
    // where the two differ. A cross-asset payment has no such fallback: the
    // lock is the merchant's number in the merchant's asset, so it is left
    // for an operator rather than guessed at.
    const authorized =
      (await this.#authorizedAmount(transaction.id, railAsset)) ??
      (railAsset === transaction.settlementAsset ? transaction.settlementAmount : undefined);
    if (authorized === undefined) return false;

    // Rebuilt from what was recorded, never re-priced. The payer signed for
    // this amount, and a quote that has moved since says nothing about the
    // transfer already on the chain.
    const requirements: PaymentRequirements = {
      scheme: "exact",
      network: caip2Of(chain),
      amount: authorized.amount.toString(),
      asset: terms.contract,
      payTo: terms.payTo,
      maxTimeoutSeconds: terms.maxTimeoutSeconds,
    };

    if (railAsset !== transaction.settlementAsset) {
      await this.#recoverCrossAsset(transaction, chain, authorized, requirements, confirmer);
      return true;
    }

    const settlement = await confirmSettlement(
      { success: true, transaction: txHash, network: caip2Of(chain) },
      requirements,
      confirmer,
    );
    await this.#options.engine.recordFacilitatorSettlement(transaction.id, {
      chain,
      txHash: settlement.transaction,
      amount: {
        amount: BigInt(settlement.transfer.value),
        asset: transaction.settlementAsset,
      },
    });
    return true;
  }

  /**
   * The contract, payTo and deadline a payment was signed under, whichever
   * kind of offer it paid for (#273).
   *
   * A resource names its registry row; a payable names its quote row, and the
   * quote's snapshot is the contract — a merchant who rotated rails after the
   * broadcast does not get to change the terms of a transfer already on the
   * chain. Matched on chain *and* asset: an offer may accept two tokens on one
   * chain, and picking by chain alone reads the wrong contract and payTo.
   */
  async #signedTerms(
    intent: PaymentIntent,
    chain: ChainId,
    railAsset: AssetCode,
  ): Promise<{ contract: string; payTo: string; maxTimeoutSeconds: number } | undefined> {
    if (intent.metadata.x402Resource !== undefined) {
      const resource = await this.#options.resources.findById(intent.metadata.x402Resource);
      if (resource === undefined) return undefined;
      const accept = resource.accepts.find(
        (candidate) => candidate.chain === chain && candidate.asset === railAsset,
      );
      if (accept === undefined) return undefined;
      return {
        contract: accept.contract,
        payTo: accept.payTo,
        maxTimeoutSeconds: resource.maxTimeoutSeconds,
      };
    }

    const quotes = this.#options.payableQuotes;
    const kind = intent.metadata.x402PayableKind;
    if (quotes === undefined || kind === undefined || !isPayableKind(kind)) return undefined;
    const quote = await quotes.find(kind, intent.metadata.x402PayableId ?? "");
    if (quote === undefined) return undefined;
    const accept = quote.accepts.find(
      (candidate) => candidate.chain === chain && candidate.asset === railAsset,
    );
    if (accept === undefined) return undefined;
    // A payable's deadline is the quote lock, and the quote is long spent by
    // the time a resume runs — this number only has to satisfy the shape.
    return {
      contract: accept.contract,
      payTo: accept.payTo,
      maxTimeoutSeconds: this.#options.quoteTtlSeconds,
    };
  }

  /** Sends or resumes the return of refundable exact-output change. */
  async #refundPayerSurplus(transaction: ClearingTransaction, chain: ChainId): Promise<void> {
    const settler = this.#options.crossAssetSettler;
    if (settler === undefined) {
      throw new ValidationError("This deployment cannot return payer surplus", {
        clearingTransactionId: transaction.id,
      });
    }
    const events = await this.#options.engine.history(transaction.id);
    const receipt = events.findLast(
      (event) =>
        (event.payload as { payerSurplusDisposition?: unknown }).payerSurplusDisposition ===
        "refundable",
    );
    if (receipt === undefined) return;
    const payload = receipt.payload as {
      payerSurplus?: SerializedMoney;
      payerRefundAddress?: unknown;
    };
    if (payload.payerSurplus === undefined || typeof payload.payerRefundAddress !== "string") {
      throw new ValidationError("Refundable payer surplus has no amount or payer address", {
        clearingTransactionId: transaction.id,
      });
    }

    const request: PayerSurplusRefundRequest = {
      chain,
      amount: deserializeMoney(payload.payerSurplus),
      recipient: payload.payerRefundAddress,
    };
    const broadcast = events.findLast((event) => event.type === "payer-surplus.refund.broadcast");
    const recorded = (broadcast?.payload as { providerReference?: unknown } | undefined)
      ?.providerReference;
    const txHash = typeof recorded === "string" ? recorded : await settler.sendRefund(request);
    if (recorded === undefined) {
      await this.#options.engine.recordPayerSurplusRefundBroadcast(
        transaction.id,
        txHash,
        request.amount,
        request.recipient,
      );
    }
    const refund = await settler.confirmRefund(txHash, request);
    await this.#options.engine.recordPayerSurplusRefundConfirmed(
      transaction.id,
      refund.transaction,
      refund.amount,
      request.recipient,
    );
  }

  /**
   * What the payer authorised, read off the `settlement.broadcast` event.
   *
   * `undefined` for a payment broadcast before the event carried it, which is
   * not something to guess at: the amount is in the payer's asset, and the only
   * other number available is the merchant's in a different one.
   */
  async #authorizedAmount(
    clearingTransactionId: string,
    railAsset: AssetCode,
  ): Promise<Money | undefined> {
    const events = await this.#options.engine.history(clearingTransactionId);
    const broadcast = events.findLast((event) => event.type === "settlement.broadcast");
    const serialized = (broadcast?.payload as { authorized?: SerializedMoney } | undefined)
      ?.authorized;
    if (serialized === undefined) return undefined;
    const authorized = deserializeMoney(serialized);
    return authorized.asset === railAsset ? authorized : undefined;
  }

  /**
   * Finishes a cross-asset payment interrupted between its two chain movements (#211).
   *
   * Two movements means two ways to be interrupted, and the `settlement.swap`
   * event is what tells them apart: with it the swap has gone out and only needs
   * confirming, without it the payer's asset is sitting at the operator and the
   * swap still has to be sent. Confirming the wrong one credits a merchant who
   * was never paid, which is why this used to be skipped rather than guessed at.
   *
   * The authorization is confirmed first in both branches, and not only for the
   * payer's address. Sending a swap for an authorization that never landed
   * spends the operator's own balance on a payment nobody made — and a resume,
   * unlike the original settle, has no facilitator response in front of it
   * saying the transfer went out at all.
   */
  async #recoverCrossAsset(
    transaction: ClearingTransaction,
    chain: ChainId,
    authorized: Money,
    requirements: PaymentRequirements,
    confirmer: SettlementConfirmer,
  ): Promise<void> {
    const locked = transaction.settlementAmount;
    const settler = this.#options.crossAssetSettler;
    const recipient = await this.#options.settlementAddressOf?.(transaction.merchant.id, chain);
    if (locked === undefined || settler === undefined || recipient === undefined) {
      throw new ValidationError("This deployment cannot finish a cross-asset payment", {
        clearingTransactionId: transaction.id,
        chain,
      });
    }

    const events = await this.#options.engine.history(transaction.id);
    const swapped = events.some((event) => event.type === "settlement.swap");
    const broadcast = events.findLast((event) => event.type === "settlement.broadcast");
    const authorization = (broadcast?.payload as { providerReference?: string } | undefined)
      ?.providerReference;
    if (authorization === undefined) {
      throw new ValidationError("A cross-asset payment has no authorization to resume from", {
        clearingTransactionId: transaction.id,
      });
    }

    const landed = await confirmSettlement(
      { success: true, transaction: authorization, network: requirements.network },
      requirements,
      confirmer,
    );

    const request: CrossAssetSwapRequest = {
      chain,
      held: authorized,
      exactOut: locked,
      recipient,
    };
    // `providerReference` is the swap's hash once the swap has been recorded,
    // which is exactly the case this branch is for.
    const swap = swapped
      ? await this.#confirmSwap(transaction.providerReference ?? "", request)
      : await this.#swap(transaction.id, request);

    await this.#options.engine.recordFacilitatorSettlement(transaction.id, {
      ...swap,
      payer: landed.payer,
    });
  }

  /** Reads a swap that was already sent, in the shape `#swap` returns. */
  async #confirmSwap(
    txHash: string,
    request: CrossAssetSwapRequest,
  ): Promise<{ chain: ChainId; txHash: string; amount: Money; surplus: Money }> {
    const settler = this.#options.crossAssetSettler;
    if (settler === undefined) {
      throw new ValidationError("x402 cannot settle a cross-asset payment on this deployment", {
        txHash,
      });
    }
    const swap = await settler.confirm(txHash, request);
    return {
      chain: request.chain,
      txHash: swap.transaction,
      amount: swap.delivered,
      surplus: money(request.held.amount - swap.spent.amount, request.held.asset),
    };
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

/** Chains in the order first seen, without repeating one a resource lists twice. */
function distinct(chains: readonly ChainId[]): ChainId[] {
  return [...new Set(chains)];
}

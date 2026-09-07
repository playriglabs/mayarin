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
import type { ClearingEngine, RateProvider } from "@mayarin/clearing";
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
  convert,
  type Money,
  money,
  NotFoundError,
  roundUpToPayerPrecision,
  ValidationError,
} from "@mayarin/shared";
import type {
  AcceptedAsset,
  AssetCapabilities,
  CrossAssetSettler,
  CrossAssetSwapRequest,
  FacilitatorRegistry,
  PaymentPayload,
  PaymentRequired,
  PricedAsset,
  RailChoice,
  RailObservation,
  RailObservationSource,
  SettlementConfirmer,
  SettleResponse,
  X402Resource,
  X402ResourceRepository,
} from "@mayarin/x402";
import {
  authorizationWithinLock,
  buildPaymentRequired,
  chooseRail,
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

    const settlementAsset = await this.#options.settlementAssetOf(resource.merchantId);
    const priced: PricedAsset[] = [];
    for (const accept of resource.accepts) {
      if (!this.#options.facilitators.canServe(requirementsProbe(accept))) continue;
      const asked = await this.#asked(accept);
      if (asked === undefined) continue;
      const amount =
        asked.asset === settlementAsset
          ? await this.#priceInto(resource.price, asked)
          : await this.#priceCrossAsset(resource.price, asked, settlementAsset);
      if (amount === undefined) continue;
      priced.push({ accept: asked, amount, expiresAt });
    }

    if (priced.length === 0) {
      throw new ValidationError(`x402 resource ${resource.id} has no way to be paid right now`, {
        resourceId: resource.id,
      });
    }

    const ordered = await this.#ordered(priced);
    return error === undefined
      ? buildPaymentRequired(resource, ordered, now)
      : buildPaymentRequired(resource, ordered, now, error);
  }

  /**
   * Which rail this resource should be paid on, and why.
   *
   * Exposed because the ordering below is a decision made on live data, and a
   * decision an agent cannot see the reasoning for is one it has to take on
   * trust. Also what makes `unobserved` legible: the choice says out loud when
   * it is really just the first accepted rail.
   */
  async railChoice(resource: X402Resource): Promise<RailChoice> {
    const chains = distinct(resource.accepts.map((accept) => accept.chain));
    return chooseRail(chains, await this.#observe(chains));
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
      throw new ValidationError("x402 payment does not match a pending same-asset lock", {
        intentId: intent.id,
      });
    }

    // Planned before the payer's money moves, and that ordering is the whole
    // point of planning at all. A route needing more than the authorization
    // carries is unexecutable, and discovering it after
    // `transferWithAuthorization` has landed leaves the payer's asset at the
    // operator, the merchant unpaid, and the nonce spent so no retry can pay.
    const swapRequest = crossAsset
      ? await this.#planSwap(resource.merchantId, rail.chain, authorized, locked)
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
      await this.#options.engine.recordFacilitatorBroadcast(transaction.id, response.transaction);
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

    return { response, intent: await this.#options.intents.getById(intent.id) };
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
        // A cross-asset payment has two chain movements and this sweep knows
        // how to finish one of them. Which one the reference names is readable
        // — the `settlement.swap` event says the swap has gone out — but the
        // resume differs in each case: before the swap it has to be sent, and
        // after it, confirmed against the merchant rather than the operator.
        // Left alone rather than confirmed wrongly, and named so an operator
        // sees it rather than watching a sweep retry forever. See #211.
        if (intent.payment?.asset !== transaction.settlementAsset) continue;
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

/** Chains in the order first seen, without repeating one a resource lists twice. */
function distinct(chains: readonly ChainId[]): ChainId[] {
  return [...new Set(chains)];
}

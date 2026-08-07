/**
 * Contract-path assembly for the composition root (#61).
 *
 * Two pieces, split by when they run:
 *
 * - **`ApiContractPlanner`** implements the clearing engine's
 *   `ContractPaymentPlanner` port at lock time: fiat leg and swap leg through
 *   the quote engine, the fee from the fee policy, the signed EIP-712 order
 *   from the quote signer. The signed numbers persist with the transaction.
 * - **`ContractCheckout`** runs at submit time, per attempt: it fetches a
 *   fresh executable route (routes go stale much faster than prices — never
 *   cached), and for a native payer builds the ready `payEth` transaction.
 *
 * Everything here is composition: it names concrete adapters, and nothing
 * below it does.
 */

import { type ChainId, EVM_CHAIN_IDS } from "@mayarin/chain";
import type {
  ClearingContract,
  ClearingEngine,
  ContractLock,
  ContractLockRequest,
  ContractPaymentPlanner,
  FeePolicy,
} from "@mayarin/clearing";
import type { ExecutableRoute, SwapRouteSource } from "@mayarin/execution";
import type { PaymentIntentService } from "@mayarin/payment-intent";
import { buildPayEthCall, deriveIntentId, type RouterCall } from "@mayarin/provider-evm";
import { ZeroExRouteSource } from "@mayarin/provider-swap-0x";
import { UniswapRouteSource } from "@mayarin/provider-swap-uniswap";
import {
  assembleOrder,
  type LockedQuote,
  lockQuote,
  type Order,
  type OrderDomain,
  signOrder,
} from "@mayarin/quote";
import {
  assetDecimals,
  type Clock,
  ConfigurationError,
  ConflictError,
  type Money,
  money,
  QuoteExpiredError,
  ValidationError,
} from "@mayarin/shared";
import type { StablecoinRegistry } from "@mayarin/stablecoin";
import type { Config, ContractConfig } from "./config.ts";
import type { QuoteLayer } from "./quote-layer.ts";

type Hex = `0x${string}`;

export interface ContractLayerOptions {
  readonly contract: ContractConfig;
  readonly quote: QuoteLayer;
  readonly fees: FeePolicy;
  readonly stablecoins: StablecoinRegistry;
  readonly clock: Clock;
}

export class ApiContractPlanner implements ContractPaymentPlanner {
  readonly #options: ContractLayerOptions;

  constructor(options: ContractLayerOptions) {
    this.#options = options;
  }

  async lock(request: ContractLockRequest): Promise<ContractLock> {
    const { contract, quote, fees, stablecoins, clock } = this.#options;

    const router = contract.paymentRouters[request.chain];
    if (router === undefined) {
      throw new ConfigurationError(`No PaymentRouter deployed on ${request.chain}`, {
        chain: request.chain,
      });
    }
    const settlementToken = await stablecoins.address(request.settlementAsset, request.chain);
    if (settlementToken === undefined) {
      throw new ConfigurationError(
        `Settlement asset ${request.settlementAsset} has no token address on ${request.chain}`,
        { asset: request.settlementAsset, chain: request.chain },
      );
    }

    // The probe sizes the swap leg's depth. One whole unit is a second-order
    // approximation the quote engine's own docs accept; the executable route
    // reprices the true size at submit time either way.
    const probe = money(10n ** BigInt(assetDecimals(request.payerAsset)), request.payerAsset);
    const fiat = await quote.engine.quoteFiatPrice({
      price: request.sourceAmount,
      settlementAsset: request.settlementAsset,
      payerAsset: request.payerAsset,
      probe,
    });

    const settlementAmount = fiat.settlement.settlementAmount;
    const fee = fees.feeFor(settlementAmount, {
      merchantId: request.merchantId,
      provider: "payment-router",
    });

    const now = clock.now();
    const domain: OrderDomain = {
      chainId: EVM_CHAIN_IDS[request.chain],
      verifyingContract: router as Hex,
    };
    const context = {
      intentId: deriveIntentId(request.clearingTransactionId),
      settlementToken,
      merchantSafe: contract.merchantSafe as Hex,
      refundTo: request.payerAddress as Hex,
    };

    const composed = "composed" in fiat ? fiat.composed : undefined;
    if (composed === undefined) {
      // Same-asset: no swap leg, no lock to gross up. The payer pays exactly
      // the settlement amount and the contract takes its no-op path.
      const expiresAt = new Date(now.getTime() + quote.ttlSeconds * 1_000);
      const order: Order = {
        ...context,
        minOut: settlementAmount.amount,
        fee: fee.amount,
        deadline: BigInt(expiresAt.getTime()) / 1_000n,
      };
      const signed = await signOrder(quote.signer, domain, order);
      return this.#contractLock({
        settlementAmount,
        fee,
        rate: {
          from: request.settlementAsset,
          to: request.settlementAsset,
          minorUnitsPerWholeUnit: 10n ** BigInt(assetDecimals(request.settlementAsset)),
          source: fiat.settlement.source,
          lockedAt: now,
          expiresAt,
        },
        payerEstimate: settlementAmount,
        expiresAt,
        order: signed.order,
        signature: signed.signature,
      });
    }

    const locked: LockedQuote = lockQuote(
      composed,
      {
        settlementAmount,
        fee,
        slippageBps: quote.slippageBps,
        ttlSeconds: quote.ttlSeconds,
      },
      now,
    );
    const signed = await signOrder(quote.signer, domain, assembleOrder(locked, context, now));

    return this.#contractLock({
      settlementAmount,
      fee,
      rate: {
        from: request.payerAsset,
        to: request.settlementAsset,
        minorUnitsPerWholeUnit: locked.executableRate,
        source: locked.executableSource,
        lockedAt: now,
        expiresAt: locked.deadline,
      },
      payerEstimate: locked.payerEstimate.amount,
      expiresAt: locked.deadline,
      order: signed.order,
      signature: signed.signature,
    });
  }

  async #contractLock(parts: {
    readonly settlementAmount: Money;
    readonly fee: Money;
    readonly rate: ContractLock["rate"];
    readonly payerEstimate: Money;
    readonly expiresAt: Date;
    readonly order: Order;
    readonly signature: Hex;
  }): Promise<ContractLock> {
    return {
      settlementAmount: parts.settlementAmount,
      fee: parts.fee,
      rate: parts.rate,
      payerEstimate: parts.payerEstimate,
      expiresAt: parts.expiresAt,
      order: {
        intentId: parts.order.intentId,
        settlementToken: parts.order.settlementToken,
        minOut: parts.order.minOut,
        fee: parts.order.fee,
        merchantSafe: parts.order.merchantSafe,
        refundTo: parts.order.refundTo,
        deadline: parts.order.deadline,
        signature: parts.signature,
        signer: await this.#options.quote.signer.address(),
      },
    };
  }
}

/** What the checkout UI needs to submit a contract-path payment. */
export interface ContractCallView {
  readonly chain: ChainId;
  readonly chainId: bigint;
  readonly paymentRouter: string;
  readonly order: Order;
  readonly signature: Hex;
  /** Fresh executable route; `null` on the same-asset no-op path. */
  readonly route: ExecutableRoute | null;
  /** Ready `payEth` transaction for a native payer; `null` for ERC-20 payers. */
  readonly payEth: RouterCall | null;
  readonly payerEstimate: Money;
  readonly expiresAt: Date;
}

export interface ContractCheckoutOptions {
  readonly engine: ClearingEngine;
  readonly intents: PaymentIntentService;
  readonly contract: ContractConfig;
  readonly routeSources: ReadonlyMap<string, SwapRouteSource>;
  readonly clock: Clock;
}

export class ContractCheckout {
  readonly #options: ContractCheckoutOptions;

  constructor(options: ContractCheckoutOptions) {
    this.#options = options;
  }

  /**
   * Builds the submit payload for a waiting contract-path payment. The route
   * is fetched fresh on every call — a stale route reverts on-chain and
   * costs the payer gas, so it is never cached.
   */
  async contractCall(id: string): Promise<ContractCallView> {
    const { engine, intents, contract: config, clock } = this.#options;

    // Accepts either id, like the payment view: callers hold whichever they
    // were handed.
    const byIntent = await engine.findByPaymentIntentId(id);
    const transaction = byIntent ?? (await engine.getById(id));
    const transactionId = transaction.id;
    if (transaction.executionPath !== "on-chain-contract") {
      throw new ValidationError(
        `Clearing transaction ${transactionId} is not on the on-chain-contract path`,
        { id: transactionId },
      );
    }
    if (transaction.state !== "PAYMENT_PENDING") {
      throw new ConflictError(
        `Clearing transaction ${transactionId} is ${transaction.state}, not awaiting payment`,
        { id: transactionId, state: transaction.state },
      );
    }
    const lock = transaction.contract;
    if (lock === undefined) {
      throw new ValidationError(`Clearing transaction ${transactionId} has no contract lock`, {
        id: transactionId,
      });
    }
    if (clock.now().getTime() > lock.expiresAt.getTime()) {
      throw new QuoteExpiredError(
        `The quote lock for ${transactionId} has expired; request a new payment`,
        { id: transactionId, expiresAt: lock.expiresAt.toISOString() },
      );
    }

    const intent = await intents.getById(transaction.paymentIntentId);
    const rail = intent.payment;
    if (rail === undefined) {
      throw new ValidationError(`Payment intent ${intent.id} names no payment rail`, {
        paymentIntentId: intent.id,
      });
    }
    const paymentRouter = config.paymentRouters[rail.chain];
    if (paymentRouter === undefined) {
      throw new ConfigurationError(`No PaymentRouter deployed on ${rail.chain}`, {
        chain: rail.chain,
      });
    }

    const order = toQuoteOrder(lock.order);
    const signature = lock.order.signature as Hex;
    const sameAsset = rail.asset === transaction.settlementAsset;
    const route = sameAsset
      ? null
      : await this.#route(
          rail.asset,
          transaction.settlementAsset,
          lock,
          paymentRouter,
          transaction.rate?.source,
        );

    const payEth =
      route !== null && rail.asset === "ETH"
        ? buildPayEthCall({
            paymentRouter: paymentRouter as Hex,
            order,
            signature,
            route,
            value: lock.payerEstimate.amount,
          })
        : null;

    return {
      chain: rail.chain,
      chainId: EVM_CHAIN_IDS[rail.chain],
      paymentRouter,
      order,
      signature,
      route,
      payEth,
      payerEstimate: lock.payerEstimate,
      expiresAt: lock.expiresAt,
    };
  }

  async #route(
    payerAsset: Money["asset"],
    settlementAsset: Money["asset"],
    lock: ClearingContract,
    recipient: string,
    pricedBy: string | undefined,
  ): Promise<ExecutableRoute> {
    // Prefer the venue that priced the lock (LiFi prices but cannot route, so
    // it is never in the map); fall back to any route-capable venue.
    const preferred = pricedBy === undefined ? undefined : this.#options.routeSources.get(pricedBy);
    const source = preferred ?? this.#options.routeSources.values().next().value ?? undefined;
    if (source === undefined) {
      throw new ConfigurationError("No route-capable venue is configured", {});
    }
    return source.route({
      payerAsset,
      settlementAsset,
      exactOut: money(lock.order.minOut, settlementAsset),
      maxIn: lock.payerEstimate,
      recipient,
    });
  }
}

function toQuoteOrder(order: ClearingContract["order"]): Order {
  return {
    intentId: order.intentId as Hex,
    settlementToken: order.settlementToken as Hex,
    minOut: order.minOut,
    fee: order.fee,
    merchantSafe: order.merchantSafe as Hex,
    refundTo: order.refundTo as Hex,
    deadline: order.deadline,
  };
}

/** Builds the route sources the checkout fetches from, keyed by venue name. */
export function createRouteSources(config: Config): ReadonlyMap<string, SwapRouteSource> {
  const sources = new Map<string, SwapRouteSource>();
  for (const name of config.quote?.venues ?? []) {
    if (name === "0x") {
      sources.set(
        "0x",
        new ZeroExRouteSource({
          pairs: config.zeroExPairs as never,
          chainId: config.zeroExChainId ?? 0,
          apiKey: config.zeroExApiKey ?? "",
        }),
      );
    }
    if (name === "uniswap") {
      sources.set(
        "uniswap",
        new UniswapRouteSource({
          swapRouters: config.uniswapSwapRouters,
          pools: config.uniswapPools as never,
        }),
      );
    }
    // LiFi is price-only by design (#57): no exact-output API, no route source.
  }
  return sources;
}

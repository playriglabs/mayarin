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
import type { MerchantAssetPolicySource, PaymentIntentService } from "@mayarin/payment-intent";
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
  add,
  assetDecimals,
  type Clock,
  ConfigurationError,
  ConflictError,
  type Money,
  money,
  QuoteExpiredError,
  RATE_SCALE,
  ValidationError,
} from "@mayarin/shared";
import type { StablecoinRegistry } from "@mayarin/stablecoin";
import type {
  SettlementAddressResolver,
  SettlementDestination,
  WalletGuard,
} from "@mayarin/wallet";
import type { Config, ContractConfig } from "./config.ts";
import type { QuoteLayer } from "./quote-layer.ts";

type Hex = `0x${string}`;

export interface ContractLayerOptions {
  readonly contract: ContractConfig;
  /**
   * Resolved per lock rather than held, so a feed or pool added at runtime
   * (#95) reaches the next payment without a restart. The resolver hands back a
   * cached layer and rebuilds it only when the market config version moves.
   */
  readonly quote: () => Promise<QuoteLayer>;
  readonly fees: FeePolicy;
  /** Reimburses successful relayed submissions; payer-submitted calls skip it. */
  readonly relayerGasFees: FeePolicy;
  readonly stablecoins: StablecoinRegistry;
  /**
   * Where each merchant is paid. Read per lock rather than configured once:
   * `merchantSafe` is inside the EIP-712 digest the contract verifies, so a
   * single deployment-wide address would pay every merchant into the same
   * wallet with no way to tell the payments apart afterwards.
   */
  readonly merchantPolicies: MerchantAssetPolicySource;
  /**
   * Enforces the payout destination's source-specific rules (#11, RFC #6).
   *
   * `merchantSafe` goes inside the EIP-712 digest, so signing is the last
   * moment anything can object. Optional only so a deployment without the chain
   * layer need not build one; where the contract path runs, it is wired.
   */
  readonly wallets?: WalletGuard;
  /**
   * Falls back to the merchant's managed wallet when they have set no settlement
   * address (#11).
   *
   * A merchant who was provisioned a Safe and never named it in the settings
   * form has a payout destination and cannot be paid at it, and nothing about
   * that state looks wrong until a payment refuses to lock. Optional for the
   * same reason as `wallets`: a deployment with no wallet registry has nothing
   * to fall back to, and then an unset address is still a refusal.
   */
  readonly settlementAddresses?: SettlementAddressResolver;
  readonly clock: Clock;
}

export class ApiContractPlanner implements ContractPaymentPlanner {
  readonly #options: ContractLayerOptions;

  constructor(options: ContractLayerOptions) {
    this.#options = options;
  }

  async lock(request: ContractLockRequest): Promise<ContractLock> {
    const { contract, fees, stablecoins, merchantPolicies, clock } = this.#options;
    const quote = await this.#options.quote();

    const configured = (await merchantPolicies.policyFor(request.merchantId))?.settlementAddress;
    // What the merchant set wins; unset falls back to the wallet Mayarin
    // provisioned for them on this chain. Keep the source attached because a
    // scoped settings choice and a managed fallback have different trust rules.
    const destination: SettlementDestination | undefined =
      this.#options.settlementAddresses === undefined
        ? configured === undefined
          ? undefined
          : { source: "configured", address: configured }
        : await this.#options.settlementAddresses.resolve(
            request.merchantId,
            request.chain,
            configured,
          );
    if (destination === undefined) {
      throw new ConfigurationError(
        `Merchant ${request.merchantId} has no settlement address; the on-chain-contract path cannot sign an order without one`,
        { merchantId: request.merchantId },
      );
    }

    // Checked before anything is signed. Explicit external destinations are
    // authorised by the merchant's scoped, audited settings write; managed
    // fallbacks still have to be verified wallets belonging to that merchant.
    await this.#options.wallets?.assertPayable(request.merchantId, request.chain, destination);
    const merchantSafe = destination.address;

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
      // The swap leg executes here, so it is priced here. Without this the lock
      // took whichever venue was configured first, on whatever chain its pool
      // happened to be.
      chain: request.chain,
    });

    const settlementAmount = fiat.settlement.settlementAmount;
    const protocolFee = fees.feeFor(settlementAmount, {
      merchantId: request.merchantId,
      provider: "payment-router",
    });
    const gasFee =
      request.submission === "relayer"
        ? this.#options.relayerGasFees.feeFor(settlementAmount, {
            merchantId: request.merchantId,
            provider: "payment-router-gas",
          })
        : money(0n, settlementAmount.asset);
    const fee = add(protocolFee, gasFee);

    const now = clock.now();
    const domain: OrderDomain = {
      chainId: EVM_CHAIN_IDS[request.chain],
      verifyingContract: router as Hex,
    };
    const context = {
      intentId: deriveIntentId(request.clearingTransactionId),
      settlementToken,
      merchantSafe: merchantSafe as Hex,
      refundTo: request.payerAddress as Hex,
    };
    const orderDeadline =
      request.orderExpiresAt === undefined
        ? undefined
        : BigInt(request.orderExpiresAt.getTime()) / 1_000n;

    const composed = "composed" in fiat ? fiat.composed : undefined;
    if (composed === undefined) {
      // Same-asset: no swap leg, no lock to gross up. The payer pays exactly
      // the settlement amount and the contract takes its no-op path.
      const expiresAt = new Date(now.getTime() + quote.ttlSeconds * 1_000);
      const order: Order = {
        ...context,
        minOut: settlementAmount.amount,
        fee: fee.amount,
        deadline: orderDeadline ?? BigInt(expiresAt.getTime()) / 1_000n,
      };
      const signed = await signOrder(quote.signer, domain, order);
      return this.#contractLock({
        settlementAmount,
        fee,
        rate: {
          from: request.settlementAsset,
          to: request.settlementAsset,
          scaledRate: 10n ** BigInt(assetDecimals(request.settlementAsset)) * RATE_SCALE,
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
    const assembled = assembleOrder(locked, context, now);
    const signed = await signOrder(quote.signer, domain, {
      ...assembled,
      deadline: orderDeadline ?? assembled.deadline,
    });

    return this.#contractLock({
      settlementAmount,
      fee,
      rate: {
        from: request.payerAsset,
        to: request.settlementAsset,
        scaledRate: locked.executableRate,
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
        signer: await (await this.#options.quote()).signer.address(),
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
  /** Resolved per call for the same reason the quote layer is (#95). */
  readonly routeSources: () => Promise<ReadonlyMap<string, SwapRouteSource>>;
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
          rail.chain,
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
    chain: ChainId,
    pricedBy: string | undefined,
  ): Promise<ExecutableRoute> {
    // Prefer the venue that priced the lock (LiFi prices but cannot route, so
    // it is never in the map); fall back to the others in order. A venue whose
    // pool is on another chain refuses with a `ConfigurationError` here — its
    // router has no code on this chain — so the fallback reaches a venue whose
    // pool is on this chain. A non-configuration failure (a real RPC or venue
    // fault) is not something to route around: it is rethrown so the caller
    // sees the failure rather than a misleading "no venue" after the fact.
    const routeSources = await this.#options.routeSources();
    const ordered = orderRouteSources(routeSources, pricedBy);
    let lastError: unknown;
    for (const source of ordered) {
      try {
        return await source.route({
          payerAsset,
          settlementAsset,
          exactOut: money(lock.order.minOut, settlementAsset),
          maxIn: lock.payerEstimate,
          recipient,
          chain,
        });
      } catch (error) {
        if (!(error instanceof ConfigurationError)) throw error;
        lastError = error;
      }
    }
    if (lastError !== undefined) throw lastError;
    throw new ConfigurationError(`No route-capable venue is configured for ${chain}`, { chain });
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

/**
 * The priced venue first, then the rest in configuration order. A venue that
 * priced the lock is the one whose rate the `minOut` was guarded against, so it
 * is the first choice to route; the fallbacks are only reached when it cannot
 * route this chain.
 */
function orderRouteSources(
  sources: ReadonlyMap<string, SwapRouteSource>,
  pricedBy: string | undefined,
): readonly SwapRouteSource[] {
  const preferred = pricedBy === undefined ? undefined : sources.get(pricedBy);
  if (preferred === undefined) return [...sources.values()];
  const rest = [...sources.entries()]
    .filter(([name]) => name !== pricedBy)
    .map(([, source]) => source);
  return [preferred, ...rest];
}

/** Builds the route sources the checkout fetches from, keyed by venue name. */
export function createRouteSources(
  config: Config,
  /** Overridden by the runtime market config (#95); defaults to the environment's. */
  pools: Config["uniswapPools"] = config.uniswapPools,
): ReadonlyMap<string, SwapRouteSource> {
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
          pools: pools as never,
        }),
      );
    }
    // LiFi is price-only by design (#57): no exact-output API, no route source.
  }
  return sources;
}

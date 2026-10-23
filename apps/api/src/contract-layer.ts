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

import { type ChainId, evmChainIdOf, isSolanaChainId, toChainUnits } from "@mayarin/chain";
import type {
  ClearingContract,
  ClearingEngine,
  ContractEscrow,
  ContractLock,
  ContractLockRequest,
  ContractOrder,
  ContractPaymentPlanner,
  ContractRenewRequest,
  FeePolicy,
  MerchantTermsRepository,
} from "@mayarin/clearing";
import { feeUnder } from "@mayarin/clearing";
import {
  type ExecutableRoute,
  FallbackRouteSource,
  type RouteRequest,
  type SwapRouteSource,
} from "@mayarin/execution";
import type { MerchantAssetPolicySource, PaymentIntentService } from "@mayarin/payment-intent";
import {
  buildPayEthCall,
  deriveIntentId,
  ESCROW_ARBITRATION_SECONDS,
  ESCROW_CHAINS,
  ESCROW_FACTORY,
  ESCROW_FACTORY_V2,
  ESCROW_V2_CHAINS,
  escrowAddress,
  escrowArbiter,
  type RouterCall,
} from "@mayarin/provider-evm";
import {
  type BuildCrossAssetSolanaPayment,
  type BuildDirectSolanaPayment,
  buildCrossAssetSolanaPayment,
  buildDirectSolanaPayment,
  deriveSolanaIntentId,
  encodeSolanaOrderMessage,
  intentIdFromHex,
  intentIdToHex,
  paymentRouterAddresses,
  SOLANA_WRAPPED_NATIVE_MINT,
  type SolanaOrder,
  type SolanaOrderSigner,
  type SolanaSwapRoute,
} from "@mayarin/provider-solana";
import { ZeroExRouteSource } from "@mayarin/provider-swap-0x";
import { LifiRouteSource } from "@mayarin/provider-swap-lifi";
import { UniswapRouteSource } from "@mayarin/provider-swap-uniswap";
import { UniswapV2RouteSource } from "@mayarin/provider-swap-uniswap-v2";
import {
  assembleOrder,
  type LockedQuote,
  lockQuote,
  type Order,
  type OrderDomain,
  signOrder,
} from "@mayarin/quote";
import {
  type AssetCode,
  add,
  assetDecimals,
  type Clock,
  ConfigurationError,
  ConflictError,
  fromDecimalString,
  isEvmNativeAsset,
  isPositive,
  type Money,
  money,
  QuoteExpiredError,
  RATE_SCALE,
  subtract,
  ValidationError,
} from "@mayarin/shared";
import type { StablecoinRegistry } from "@mayarin/stablecoin";
import type {
  SettlementAddressResolver,
  SettlementDestination,
  WalletGuard,
} from "@mayarin/wallet";
import type { Config, ContractConfig } from "./config.ts";
import { lifiTokenAddress, type QuoteLayer } from "./quote-layer.ts";
import type { MerchantRegistry } from "./services/merchant-registry.ts";

type Hex = `0x${string}`;

export interface ContractLayerOptions {
  readonly contract: ContractConfig;
  /**
   * Resolved per lock rather than held, so a feed or pool added at runtime
   * (#95) reaches the next payment without a restart. The resolver hands back a
   * cached layer and rebuilds it only when the market config version moves.
   */
  readonly quote: () => Promise<QuoteLayer>;
  /** The merchant's protocol fee, read per lock. */
  readonly terms: MerchantTermsRepository;
  /** Reimburses successful relayed submissions; payer-submitted calls skip it. */
  readonly relayerGasFees: FeePolicy;
  /**
   * The least a relayed submission reimburses, per chain, in whole units of the
   * settlement asset. The percentage alone loses money on a small payment and on
   * an expensive chain; this is the floor under it.
   */
  readonly relayerGasFeeMinimums: Readonly<Partial<Record<ChainId, string>>>;
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
  /**
   * Asked before an EVM order is signed whether the chain's router will pay the
   * destination (SEC-06). Optional: a deployment whose routers have no registry
   * has nothing to ask.
   */
  readonly registry?: MerchantRegistry;
  /** Mayarin Resolution: the arbiter an escrow names when the merchant names none (#304). */
  readonly escrowArbiter?: string;
  readonly clock: Clock;
  readonly solana?: {
    readonly signer: SolanaOrderSigner;
    readonly deploymentDomains: Readonly<Partial<Record<ChainId, Uint8Array>>>;
  };
}

export class ApiContractPlanner implements ContractPaymentPlanner {
  readonly #options: ContractLayerOptions;

  constructor(options: ContractLayerOptions) {
    this.#options = options;
  }

  /** The percentage, or the chain's floor when that is more: gas is not a percentage. */
  #relayerGasFee(chain: ChainId, settlementAmount: Money, merchantId: string): Money {
    const byRate = this.#options.relayerGasFees.feeFor(settlementAmount, {
      merchantId,
      provider: "payment-router-gas",
    });
    const minimum = this.#options.relayerGasFeeMinimums[chain];
    if (minimum === undefined) return byRate;
    const floor = fromDecimalString(minimum, settlementAmount.asset);
    return floor.amount > byRate.amount ? floor : byRate;
  }

  async lock(request: ContractLockRequest): Promise<ContractLock> {
    const { contract, terms, stablecoins, merchantPolicies, clock } = this.#options;
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
    const protocolFee = feeUnder(await terms.get(request.merchantId), settlementAmount);
    const gasFee =
      request.submission === "relayer"
        ? this.#relayerGasFee(request.chain, settlementAmount, request.merchantId)
        : money(0n, settlementAmount.asset);
    const fee = add(protocolFee, gasFee);
    // The router refuses an order that leaves the merchant nothing, but only on
    // chain, after the payer has paid gas. A fee floor makes that reachable for
    // a small payment, so it is refused here, before anything is signed.
    if (!isPositive(subtract(settlementAmount, fee))) {
      throw new ValidationError(
        "Fee consumes the entire settlement amount; nothing would reach the merchant",
        {
          settlementAmount: settlementAmount.amount.toString(),
          fee: fee.amount.toString(),
          asset: settlementAmount.asset,
        },
      );
    }

    const now = clock.now();
    const expiresAt = new Date(now.getTime() + quote.ttlSeconds * 1_000);
    const orderDeadline =
      request.orderExpiresAt === undefined
        ? BigInt(expiresAt.getTime()) / 1_000n
        : BigInt(request.orderExpiresAt.getTime()) / 1_000n;
    if (isSolanaChainId(request.chain)) {
      if (request.escrow !== undefined) {
        throw new ValidationError(`Escrow is not available on ${request.chain}`, {
          chain: request.chain,
        });
      }
      const solana = this.#options.solana;
      const deploymentDomain = solana?.deploymentDomains[request.chain];
      if (solana === undefined || deploymentDomain === undefined) {
        throw new ConfigurationError(`Solana order signing is not configured on ${request.chain}`, {
          chain: request.chain,
        });
      }
      const solanaOrder: SolanaOrder = {
        intentId: deriveSolanaIntentId(request.clearingTransactionId),
        settlementMint: settlementToken,
        minOut: settlementAmount.amount,
        fee: fee.amount,
        merchant: merchantSafe,
        refundTo: request.payerAddress,
        deadline: orderDeadline,
      };
      const { config: configPda } = paymentRouterAddresses(router);
      const signature = await solana.signer.sign(
        encodeSolanaOrderMessage({
          programId: router,
          config: configPda.toBase58(),
          deploymentDomain,
          order: solanaOrder,
        }),
      );
      const composed = "composed" in fiat ? fiat.composed : undefined;
      const locked =
        composed === undefined
          ? undefined
          : lockQuote(
              composed,
              {
                settlementAmount,
                fee,
                slippageBps: quote.slippageBps,
                ttlSeconds: quote.ttlSeconds,
              },
              now,
            );
      return {
        settlementAmount,
        fee,
        rate:
          locked === undefined
            ? {
                from: request.settlementAsset,
                to: request.settlementAsset,
                scaledRate: 10n ** BigInt(assetDecimals(request.settlementAsset)) * RATE_SCALE,
                source: fiat.settlement.source,
                lockedAt: now,
                expiresAt,
              }
            : {
                from: request.payerAsset,
                to: request.settlementAsset,
                scaledRate: locked.executableRate,
                source: locked.executableSource,
                lockedAt: now,
                expiresAt: locked.deadline,
              },
        payerEstimate: locked?.payerEstimate.amount ?? settlementAmount,
        expiresAt: locked?.deadline ?? expiresAt,
        order: {
          intentId: intentIdToHex(solanaOrder.intentId),
          settlementToken,
          minOut: solanaOrder.minOut,
          fee: solanaOrder.fee,
          merchantSafe: solanaOrder.merchant,
          refundTo: solanaOrder.refundTo,
          deadline: solanaOrder.deadline,
          signature: Buffer.from(signature).toString("base64"),
          signer: solana.signer.publicKey(),
        },
      };
    }

    const domain: OrderDomain = {
      chainId: evmChainIdOf(request.chain),
      verifyingContract: router as Hex,
    };
    const intentId = deriveIntentId(request.clearingTransactionId);
    const escrow = this.#escrow(
      request,
      intentId,
      merchantSafe,
      now,
      subtract(settlementAmount, fee),
    );
    const context = {
      intentId,
      settlementToken: settlementToken as Hex,
      // An escrowed order settles into the escrow; the merchant is its payee.
      merchantSafe: (escrow === undefined
        ? merchantSafe
        : escrowAddress({ ...escrow, intentId })) as Hex,
      refundTo: request.payerAddress as Hex,
    };
    // The destination the order will name, escrow vault included. Refused here,
    // with a reason, rather than reverting on chain at the payer's expense.
    await this.#options.registry?.assertPayable(request.chain, context.merchantSafe);
    const composed = "composed" in fiat ? fiat.composed : undefined;
    if (composed === undefined) {
      // Same-asset: no swap leg, no lock to gross up. The payer pays exactly
      // the settlement amount and the contract takes its no-op path.
      const order: Order = {
        ...context,
        minOut: settlementAmount.amount,
        fee: fee.amount,
        deadline: orderDeadline,
      };
      const signed = await signChainOrder(
        quote.signer,
        domain,
        request.chain,
        request.settlementAsset,
        order,
      );
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
        ...(escrow === undefined ? {} : { escrow }),
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
    const signed = await signChainOrder(
      quote.signer,
      domain,
      request.chain,
      request.settlementAsset,
      {
        ...assembled,
        deadline: request.orderExpiresAt === undefined ? assembled.deadline : orderDeadline,
      },
    );

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
      ...(escrow === undefined ? {} : { escrow }),
    });
  }

  /**
   * The escrow terms for an escrowed payment (#304), or `undefined`.
   *
   * The hold is counted from the price lock, not from payment: the order's
   * deadline is minutes away, so the difference is noise next to a hold of
   * days, and the terms must be fixed before the order is signed.
   */
  #escrow(
    request: ContractLockRequest,
    intentId: string,
    payee: string,
    now: Date,
    held: Money,
  ): ContractEscrow | undefined {
    if (request.escrow === undefined) return undefined;
    if (!ESCROW_CHAINS.includes(request.chain)) {
      throw new ValidationError(`Escrow is not available on ${request.chain}`, {
        chain: request.chain,
        intentId,
      });
    }
    const { payer } = request.escrow;
    const arbiter = escrowArbiter(request.escrow.arbiter ?? this.#options.escrowArbiter);
    // The contract ignores such an arbiter anyway; refusing here means the payer
    // is never shown terms whose dispute path cannot work as described.
    if (sameAddress(arbiter, payer) || sameAddress(arbiter, payee)) {
      throw new ValidationError("An escrow's arbiter cannot be its payer or its merchant", {
        intentId,
        arbiter,
      });
    }
    const releaseAfter = Math.floor(now.getTime() / 1_000) + request.escrow.holdSeconds;
    const terms = {
      payer,
      payee,
      arbiter,
      releaseAfter: BigInt(releaseAfter),
      resolveBy: BigInt(releaseAfter + ESCROW_ARBITRATION_SECONDS),
    };
    // v2 where it is deployed (#315): every new escrow there carries a bond,
    // zero when the merchant asks for none, so one chain has one factory.
    if (!ESCROW_V2_CHAINS.includes(request.chain)) return { factory: ESCROW_FACTORY, ...terms };
    const bond = (held.amount * BigInt(request.escrow.bondBps ?? 0)) / 10_000n;
    return { factory: ESCROW_FACTORY_V2, ...terms, bond };
  }

  /**
   * Re-signs a persisted order with a fresh deadline — the recovery path for a
   * deposit-match payment retried after its order expired.
   *
   * No pricing happens here, on purpose: the merchant's `minOut` was locked at
   * `PRICE_LOCKED` and stays exactly as signed, so renewal changes the
   * executable window and nothing else. Every economic field is copied
   * verbatim from the persisted order, including the `intentId` — byte-identical
   * to what the router's `consumed` guard checks on-chain.
   */
  async renew(request: ContractRenewRequest): Promise<ContractOrder> {
    const { contract } = this.#options;
    const router = contract.paymentRouters[request.chain];
    if (router === undefined) {
      throw new ConfigurationError(`No PaymentRouter deployed on ${request.chain}`, {
        chain: request.chain,
      });
    }
    const quote = await this.#options.quote();
    if (isSolanaChainId(request.chain)) {
      const solana = this.#options.solana;
      const deploymentDomain = solana?.deploymentDomains[request.chain];
      if (solana === undefined || deploymentDomain === undefined) {
        throw new ConfigurationError(`Solana order signing is not configured on ${request.chain}`, {
          chain: request.chain,
        });
      }
      const order: SolanaOrder = {
        intentId: intentIdFromHex(request.order.intentId),
        settlementMint: request.order.settlementToken,
        minOut: request.order.minOut,
        fee: request.order.fee,
        merchant: request.order.merchantSafe,
        refundTo: request.order.refundTo,
        deadline: BigInt(request.expiresAt.getTime()) / 1_000n,
      };
      const { config } = paymentRouterAddresses(router);
      const signature = await solana.signer.sign(
        encodeSolanaOrderMessage({
          programId: router,
          config: config.toBase58(),
          deploymentDomain,
          order,
        }),
      );
      return {
        ...request.order,
        deadline: order.deadline,
        signature: Buffer.from(signature).toString("base64"),
        signer: solana.signer.publicKey(),
      };
    }

    const order: Order = {
      ...toQuoteOrder(request.order),
      // Floored to whole seconds, exactly like `assembleOrder` and like lock's
      // `orderDeadline`.
      deadline: BigInt(request.expiresAt.getTime()) / 1_000n,
    };
    const signed = await signChainOrder(
      quote.signer,
      {
        chainId: evmChainIdOf(request.chain),
        verifyingContract: router as Hex,
      },
      request.chain,
      request.settlementAsset,
      order,
    );

    return {
      ...request.order,
      deadline: order.deadline,
      signature: signed.signature,
      signer: await quote.signer.address(),
    };
  }

  async #contractLock(parts: {
    readonly settlementAmount: Money;
    readonly fee: Money;
    readonly rate: ContractLock["rate"];
    readonly payerEstimate: Money;
    readonly expiresAt: Date;
    readonly order: Order;
    readonly signature: Hex;
    readonly escrow?: ContractEscrow;
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
        ...(parts.escrow === undefined ? {} : { escrow: parts.escrow }),
      },
    };
  }
}

/** What the checkout UI needs to submit a contract-path payment. */
export interface EvmContractCallView {
  readonly kind: "evm";
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

export interface SolanaContractCallView {
  readonly kind: "solana";
  readonly chain: ChainId;
  readonly paymentRouter: string;
  readonly order: ContractOrder;
  readonly signature: string;
  /** Base64 legacy (direct) or v0 (swap) transaction for the payer wallet. */
  readonly transaction: string;
  /** Submitted first when destination token accounts do not exist. */
  readonly preparationTransactions: readonly string[];
  readonly payerEstimate: Money;
  readonly expiresAt: Date;
}

export type ContractCallView = EvmContractCallView | SolanaContractCallView;

export interface SolanaRouteSource {
  route(input: {
    readonly chain: ChainId;
    readonly connection: BuildDirectSolanaPayment["connection"];
    readonly paymentRouter: string;
    readonly payer: string;
    readonly inputMint: string;
    readonly settlementMint: string;
    readonly inputAmount: bigint;
    readonly minOut: bigint;
  }): Promise<{
    readonly route: SolanaSwapRoute;
    readonly addressLookupTableAccounts: BuildCrossAssetSolanaPayment["addressLookupTableAccounts"];
  }>;
}

export interface ContractCheckoutOptions {
  readonly engine: ClearingEngine;
  readonly intents: PaymentIntentService;
  readonly contract: ContractConfig;
  readonly stablecoins: StablecoinRegistry;
  /** Resolved per call for the same reason the quote layer is (#95). */
  readonly routeSources: () => Promise<ReadonlyMap<string, SwapRouteSource>>;
  readonly clock: Clock;
  readonly solana?: {
    readonly connections: Readonly<
      Partial<Record<ChainId, BuildDirectSolanaPayment["connection"]>>
    >;
    readonly deploymentDomains: Readonly<Partial<Record<ChainId, Uint8Array>>>;
    readonly feeRecipients: Readonly<Partial<Record<ChainId, string>>>;
    readonly routeSources?: Readonly<Partial<Record<ChainId, SolanaRouteSource>>>;
  };
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

    if (isSolanaChainId(rail.chain)) {
      if (rail.payerAddress === undefined) {
        throw new ValidationError("A Solana contract payment needs the payer public key", {
          chain: rail.chain,
        });
      }
      const payer = rail.payerAddress;
      const runtime = this.#options.solana;
      const connection = runtime?.connections[rail.chain];
      const deploymentDomain = runtime?.deploymentDomains[rail.chain];
      const feeRecipient = runtime?.feeRecipients[rail.chain];
      if (
        runtime === undefined ||
        connection === undefined ||
        deploymentDomain === undefined ||
        feeRecipient === undefined
      ) {
        throw new ConfigurationError(
          `Solana transaction building is not configured on ${rail.chain}`,
          {
            chain: rail.chain,
          },
        );
      }
      const order: SolanaOrder = {
        intentId: intentIdFromHex(lock.order.intentId),
        settlementMint: lock.order.settlementToken,
        minOut: lock.order.minOut,
        fee: lock.order.fee,
        merchant: lock.order.merchantSafe,
        refundTo: lock.order.refundTo,
        deadline: lock.order.deadline,
      };
      const common = {
        connection,
        programId: paymentRouter,
        payer,
        feeRecipient,
        deploymentDomain,
        order,
        inputAmount: lock.payerEstimate.amount,
        signature: Uint8Array.from(Buffer.from(lock.order.signature, "base64")),
        signerPublicKey: lock.order.signer,
      } as const;
      const built =
        rail.asset === transaction.settlementAsset
          ? await buildDirectSolanaPayment(common)
          : await (async () => {
              const inputMint =
                rail.asset === "SOL"
                  ? SOLANA_WRAPPED_NATIVE_MINT
                  : await this.#options.stablecoins.address(rail.asset, rail.chain);
              const routeSource = runtime.routeSources?.[rail.chain];
              if (inputMint === undefined || routeSource === undefined) {
                throw new ConfigurationError(
                  `Cross-asset Solana checkout is not configured for ${rail.asset} on ${rail.chain}`,
                  { chain: rail.chain, payerAsset: rail.asset },
                );
              }
              const executable = await routeSource.route({
                chain: rail.chain,
                connection,
                paymentRouter,
                payer,
                inputMint,
                settlementMint: order.settlementMint,
                inputAmount: lock.payerEstimate.amount,
                minOut: order.minOut,
              });
              return buildCrossAssetSolanaPayment({
                ...common,
                inputMint,
                route: executable.route,
                addressLookupTableAccounts: executable.addressLookupTableAccounts,
              });
            })();
      return {
        kind: "solana",
        chain: rail.chain,
        paymentRouter,
        order: lock.order,
        signature: lock.order.signature,
        preparationTransactions: built.preparationBase64,
        transaction: built.base64,
        payerEstimate: lock.payerEstimate,
        expiresAt: lock.expiresAt,
      };
    }

    const order = toChainOrder(rail.chain, transaction.settlementAsset, toQuoteOrder(lock.order));
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
      route !== null && isEvmNativeAsset(rail.asset)
        ? buildPayEthCall({
            paymentRouter: paymentRouter as Hex,
            order,
            signature,
            route,
            value: lock.payerEstimate.amount,
          })
        : null;

    return {
      kind: "evm",
      chain: rail.chain,
      chainId: evmChainIdOf(rail.chain),
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

/**
 * An order as the token contract counts it. The domain keeps `minOut` and `fee`
 * in the asset's own minor units (the clearing engine compares them with the
 * settlement amount); the contract and the signature see the token's.
 */
function toChainOrder(chain: ChainId, settlementAsset: AssetCode, order: Order): Order {
  return {
    ...order,
    minOut: toChainUnits(chain, settlementAsset, order.minOut),
    fee: toChainUnits(chain, settlementAsset, order.fee),
  };
}

/** Signs the order in token units and hands back the one in domain units. */
async function signChainOrder(
  signer: Parameters<typeof signOrder>[0],
  domain: OrderDomain,
  chain: ChainId,
  settlementAsset: AssetCode,
  order: Order,
): Promise<Awaited<ReturnType<typeof signOrder>>> {
  const signed = await signOrder(signer, domain, toChainOrder(chain, settlementAsset, order));
  return { order, signature: signed.signature };
}

function toQuoteOrder(order: ContractOrder): Order {
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

/**
 * Every route-capable venue, rebuilt from the runtime pools on each route.
 *
 * The treasury executor and the x402 cross-asset settler are built once at
 * boot. Handing them `createRouteSources(config)` froze the `.env` pools, so a
 * pool added through the admin API (#95) priced a payment — the quote layer
 * reads the runtime config — and then failed it at execution with "Uniswap has
 * no configured pool". Resolving per route keeps pricing and execution on the
 * same pool set, the way the contract checkout already does.
 */
export class RuntimeRouteSource implements SwapRouteSource {
  readonly name = "runtime";
  readonly #config: Config;
  readonly #pools: () => Promise<Config["uniswapPools"]>;

  constructor(config: Config, pools: () => Promise<Config["uniswapPools"]>) {
    this.#config = config;
    this.#pools = pools;
  }

  async route(request: RouteRequest): Promise<ExecutableRoute> {
    const sources = [...createRouteSources(this.#config, await this.#pools()).values()];
    return new FallbackRouteSource(sources).route(request);
  }
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
    if (name === "uniswap-v2") {
      sources.set(
        "uniswap-v2",
        new UniswapV2RouteSource({
          routers: config.uniswapV2Routers,
          pairs: config.uniswapV2Pairs as never,
        }),
      );
    }
    if (name === "lifi") {
      sources.set(
        "lifi",
        new LifiRouteSource({
          tokenAddress: lifiTokenAddress(config),
          ...(config.lifiApiKey === undefined ? {} : { apiKey: config.lifiApiKey }),
          integrator: "mayarin",
        }),
      );
    }
  }
  return sources;
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

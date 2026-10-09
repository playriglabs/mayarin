import { AnchorProvider } from "@coral-xyz/anchor";
import { type ChainId, isSolanaChainId } from "@mayarin/chain";
import type { PriceQuote } from "@mayarin/clearing";
import type { SwapVenue } from "@mayarin/execution";
import {
  type AssetCode,
  assetDecimals,
  ConfigurationError,
  getAsset,
  type Money,
  ProviderError,
  scaledRateFrom,
  ValidationError,
} from "@mayarin/shared";
import { Percentage, ReadOnlyWallet } from "@orca-so/common-sdk";
import {
  buildWhirlpoolClient,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  SwapUtils,
  swapQuoteByInputToken,
  swapQuoteByOutputToken,
  TokenExtensionUtil,
  WhirlpoolContext,
  WhirlpoolIx,
} from "@orca-so/whirlpools-sdk";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { type AddressLookupTableAccount, Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  paymentRouterAddresses,
  SOLANA_WRAPPED_NATIVE_MINT,
  type SolanaSwapRoute,
} from "./payment.ts";

export const ORCA_DEVNET_USDC_MINT = "BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k";
export const ORCA_DEVNET_PYUSD_MINT = "Hy5ZLF26P3bjfVtrt4qDQCn6HGhS5izb5SNv7P9qmgcG";
export const ORCA_DEVNET_USDC_PYUSD_WHIRLPOOL = "J3J1hfwBCXgqp5vVPyfwkzUmcWRpsh3FdAvDiLEMzzYZ";

export interface OrcaWhirlpoolRoute {
  readonly address: string;
  readonly tokenMintA: string;
  readonly tokenMintB: string;
}

export interface OrcaRouteRequest {
  readonly connection: Connection;
  readonly paymentRouter: string;
  readonly inputMint: string;
  readonly settlementMint: string;
  readonly inputAmount: bigint;
  readonly minOut: bigint;
}

export interface OrcaRouteResult {
  readonly route: SolanaSwapRoute;
  readonly addressLookupTableAccounts: readonly AddressLookupTableAccount[];
}

export interface OrcaSolanaRouteSourceOptions {
  readonly pools: readonly OrcaWhirlpoolRoute[];
  readonly slippageBps?: number;
  readonly addressLookupTables?: readonly string[];
}

export interface OrcaQuoteReadRequest {
  readonly connection: Connection;
  readonly pool: OrcaWhirlpoolRoute;
  readonly inputMint: string;
  readonly outputMint: string;
  readonly amount: bigint;
  readonly amountSpecified: "input" | "output";
}

export interface OrcaQuoteReadResult {
  readonly amountIn: bigint;
  readonly amountOut: bigint;
}

export interface OrcaQuoteReader {
  quote(request: OrcaQuoteReadRequest): Promise<OrcaQuoteReadResult>;
}

export interface OrcaSolanaSwapVenueOptions {
  readonly rpcUrls: Readonly<Partial<Record<ChainId, string>>>;
  readonly pools: Readonly<Partial<Record<ChainId, readonly OrcaWhirlpoolRoute[]>>>;
  readonly assets: Readonly<Partial<Record<ChainId, Readonly<Partial<Record<AssetCode, string>>>>>>;
  readonly nativeAssets?: Readonly<Partial<Record<ChainId, AssetCode>>>;
  readonly reader?: OrcaQuoteReader;
}

function poolSupportsPair(
  pool: OrcaWhirlpoolRoute,
  inputMint: string,
  settlementMint: string,
): boolean {
  return (
    (pool.tokenMintA === inputMint && pool.tokenMintB === settlementMint) ||
    (pool.tokenMintB === inputMint && pool.tokenMintA === settlementMint)
  );
}

function maxAmount(left: BN, right: bigint): BN {
  const rightBn = new BN(right.toString());
  return left.gte(rightBn) ? left : rightBn;
}

function swapRate(amountIn: bigint, amountOut: bigint, from: AssetCode): bigint {
  return scaledRateFrom(amountOut * 10n ** BigInt(assetDecimals(from)), amountIn, "down");
}

/**
 * A stablecoin pool should not quote an asset at a wildly different unit
 * value. Thin devnet pools can otherwise extrapolate an exact-output request
 * far beyond their liquidity and return a tiny rate; the payer estimate then
 * explodes into billions instead of making the rail unavailable.
 */
function assertStablecoinRate(from: AssetCode, to: AssetCode, scaledRate: bigint): void {
  if (getAsset(from).kind !== "stablecoin" || getAsset(to).kind !== "stablecoin") return;

  const wholeTarget = 10n ** BigInt(assetDecimals(to));
  const lower = scaledRateFrom(wholeTarget, 2n);
  const upper = scaledRateFrom(wholeTarget * 2n, 1n);
  if (scaledRate < lower || scaledRate > upper) {
    throw new ProviderError(`Orca stablecoin quote for ${from} -> ${to} is out of bounds`, {
      from,
      to,
      scaledRate: scaledRate.toString(),
    });
  }
}

class SdkOrcaQuoteReader implements OrcaQuoteReader {
  async quote(request: OrcaQuoteReadRequest): Promise<OrcaQuoteReadResult> {
    const provider = new AnchorProvider(
      request.connection,
      new ReadOnlyWallet(PublicKey.default),
      AnchorProvider.defaultOptions(),
    );
    const context = WhirlpoolContext.withProvider(provider, ORCA_WHIRLPOOL_PROGRAM_ID);
    const pool = await buildWhirlpoolClient(context).getPool(request.pool.address);
    const poolData = pool.getData();
    if (
      !poolData.tokenMintA.equals(new PublicKey(request.pool.tokenMintA)) ||
      !poolData.tokenMintB.equals(new PublicKey(request.pool.tokenMintB))
    ) {
      throw new ConfigurationError(
        `Orca Whirlpool ${request.pool.address} does not match its configured mints`,
        { pool: request.pool.address },
      );
    }

    const amount = new BN(request.amount.toString());
    const slippage = Percentage.fromFraction(0, 10_000);
    const quote =
      request.amountSpecified === "input"
        ? await swapQuoteByInputToken(
            pool,
            new PublicKey(request.inputMint),
            amount,
            slippage,
            context.program.programId,
            context.fetcher,
          )
        : await swapQuoteByOutputToken(
            pool,
            new PublicKey(request.outputMint),
            amount,
            slippage,
            context.program.programId,
            context.fetcher,
          );

    return {
      amountIn: BigInt(quote.estimatedAmountIn.toString()),
      amountOut: BigInt(quote.estimatedAmountOut.toString()),
    };
  }
}

/** Executable Orca prices for the same configured Whirlpools used at payment time. */
export class OrcaSolanaSwapVenue implements SwapVenue {
  readonly name = "orca";
  readonly #rpcUrls: OrcaSolanaSwapVenueOptions["rpcUrls"];
  readonly #pools: OrcaSolanaSwapVenueOptions["pools"];
  readonly #assets: OrcaSolanaSwapVenueOptions["assets"];
  readonly #nativeAssets: Readonly<Partial<Record<ChainId, AssetCode>>>;
  readonly #reader: OrcaQuoteReader;
  readonly #connections = new Map<ChainId, Connection>();

  constructor(options: OrcaSolanaSwapVenueOptions) {
    this.#rpcUrls = options.rpcUrls;
    this.#pools = options.pools;
    this.#assets = options.assets;
    this.#nativeAssets = options.nativeAssets ?? {};
    this.#reader = options.reader ?? new SdkOrcaQuoteReader();
  }

  async quote(from: AssetCode, to: AssetCode, amount: Money, chain?: ChainId): Promise<PriceQuote> {
    if (amount.asset !== from) {
      throw new ValidationError(
        `The amount asset ${amount.asset} must equal the sell asset ${from}`,
        {
          amountAsset: amount.asset,
          from,
        },
      );
    }
    if (amount.amount <= 0n) {
      throw new ValidationError("The Orca sell amount must be positive", {
        from,
        to,
        amount: amount.amount.toString(),
      });
    }

    return this.#quote(from, to, amount.amount, "input", chain);
  }

  async quoteExactOutput(
    from: AssetCode,
    to: AssetCode,
    exactOut: Money,
    chain?: ChainId,
  ): Promise<PriceQuote> {
    if (exactOut.asset !== to) {
      throw new ValidationError(
        `The exact output asset ${exactOut.asset} must equal the buy asset ${to}`,
        { exactOutAsset: exactOut.asset, to },
      );
    }
    if (exactOut.amount <= 0n) {
      throw new ValidationError("The Orca exact output must be positive", {
        from,
        to,
        amount: exactOut.amount.toString(),
      });
    }

    return this.#quote(from, to, exactOut.amount, "output", chain);
  }

  async #quote(
    from: AssetCode,
    to: AssetCode,
    amount: bigint,
    amountSpecified: "input" | "output",
    chain: ChainId | undefined,
  ): Promise<PriceQuote> {
    if (chain === undefined || !isSolanaChainId(chain)) {
      throw new ConfigurationError(`Orca pricing requires a Solana chain for ${from} -> ${to}`, {
        from,
        to,
        ...(chain === undefined ? {} : { chain }),
      });
    }
    const inputMint = this.#mintFor(chain, from);
    const outputMint = this.#mintFor(chain, to);
    const pool = (this.#pools[chain] ?? []).find((candidate) =>
      poolSupportsPair(candidate, inputMint, outputMint),
    );
    if (pool === undefined) {
      throw new ConfigurationError(
        `No Orca Whirlpool configured for ${from} -> ${to} on ${chain}`,
        {
          from,
          to,
          chain,
        },
      );
    }

    let quoted: OrcaQuoteReadResult;
    try {
      quoted = await this.#reader.quote({
        connection: this.#connectionFor(chain),
        pool,
        inputMint,
        outputMint,
        amount,
        amountSpecified,
      });
    } catch (error) {
      if (error instanceof ConfigurationError || error instanceof ValidationError) throw error;
      throw new ProviderError(
        `Orca quote failed on ${chain}: ${error instanceof Error ? error.message : String(error)}`,
        { chain, from, to, pool: pool.address },
        { cause: error, retryable: true },
      );
    }
    if (quoted.amountIn <= 0n || quoted.amountOut <= 0n) {
      throw new ProviderError(`Orca quoted a non-positive amount for ${from} -> ${to}`, {
        chain,
        from,
        to,
        amountIn: quoted.amountIn.toString(),
        amountOut: quoted.amountOut.toString(),
      });
    }
    const scaledRate = swapRate(quoted.amountIn, quoted.amountOut, from);
    if (scaledRate <= 0n) {
      throw new ProviderError(`Orca quote for ${from} -> ${to} rounds to zero`, {
        chain,
        from,
        to,
      });
    }
    assertStablecoinRate(from, to, scaledRate);
    return { from, to, scaledRate, source: this.name };
  }

  #mintFor(chain: ChainId, asset: AssetCode): string {
    if (this.#nativeAssets[chain] === asset) return SOLANA_WRAPPED_NATIVE_MINT;
    const mint = this.#assets[chain]?.[asset];
    if (mint !== undefined) return mint;
    throw new ConfigurationError(`No ${asset} mint configured on ${chain}`, { chain, asset });
  }

  #connectionFor(chain: ChainId): Connection {
    const cached = this.#connections.get(chain);
    if (cached !== undefined) return cached;
    const rpcUrl = this.#rpcUrls[chain];
    if (rpcUrl === undefined) {
      throw new ConfigurationError(`No RPC URL configured for ${chain}`, { chain });
    }
    const connection = new Connection(rpcUrl, "confirmed");
    this.#connections.set(chain, connection);
    return connection;
  }
}

async function lookupTableAccounts(
  connection: Connection,
  addresses: readonly string[],
): Promise<readonly AddressLookupTableAccount[]> {
  return Promise.all(
    addresses.map(async (address) => {
      const result = await connection.getAddressLookupTable(new PublicKey(address));
      if (result.value === null) {
        throw new Error(`Orca address lookup table ${address} was not found`);
      }
      return result.value;
    }),
  );
}

/**
 * Produces an executable Orca SwapV2 CPI route for the Mayarin router.
 *
 * Pool selection is driven by both the payer mint and the order's chosen
 * settlement mint. Nothing in this adapter silently substitutes one asset for
 * another: unsupported pairs fail before a transaction reaches the wallet.
 */
export class OrcaSolanaRouteSource {
  readonly #pools: readonly OrcaWhirlpoolRoute[];
  readonly #slippageBps: number;
  readonly #addressLookupTables: readonly string[];

  constructor(options: OrcaSolanaRouteSourceOptions) {
    const slippageBps = options.slippageBps ?? 100;
    if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
      throw new Error("Orca slippageBps must be an integer between 0 and 10000");
    }
    this.#pools = [...options.pools];
    this.#slippageBps = slippageBps;
    this.#addressLookupTables = [...(options.addressLookupTables ?? [])];
  }

  async route(input: OrcaRouteRequest): Promise<OrcaRouteResult> {
    const configuredPool = this.#pools.find((pool) =>
      poolSupportsPair(pool, input.inputMint, input.settlementMint),
    );
    if (configuredPool === undefined) {
      throw new Error(
        `No Orca Whirlpool configured for ${input.inputMint} -> ${input.settlementMint}`,
      );
    }

    const inputMint = new PublicKey(input.inputMint);
    const settlementMint = new PublicKey(input.settlementMint);
    const routerAuthority = paymentRouterAddresses(input.paymentRouter).routerAuthority;
    const provider = new AnchorProvider(
      input.connection,
      new ReadOnlyWallet(routerAuthority),
      AnchorProvider.defaultOptions(),
    );
    const context = WhirlpoolContext.withProvider(provider, ORCA_WHIRLPOOL_PROGRAM_ID);
    const pool = await buildWhirlpoolClient(context).getPool(configuredPool.address);
    const poolData = pool.getData();
    if (
      !poolData.tokenMintA.equals(new PublicKey(configuredPool.tokenMintA)) ||
      !poolData.tokenMintB.equals(new PublicKey(configuredPool.tokenMintB))
    ) {
      throw new Error(
        `Orca Whirlpool ${configuredPool.address} does not match its configured mints`,
      );
    }

    const quote = await swapQuoteByInputToken(
      pool,
      inputMint,
      new BN(input.inputAmount.toString()),
      Percentage.fromFraction(this.#slippageBps, 10_000),
      context.program.programId,
      context.fetcher,
    );
    if (quote.estimatedAmountOut.lt(new BN(input.minOut.toString()))) {
      throw new Error(
        `Orca quote output ${quote.estimatedAmountOut.toString()} is below required settlement ${input.minOut.toString()}`,
      );
    }

    const tokenExtensionContext = await TokenExtensionUtil.buildTokenExtensionContext(
      context.fetcher,
      poolData,
    );
    const inputTokenProgram = inputMint.equals(poolData.tokenMintA)
      ? tokenExtensionContext.tokenMintWithProgramA.tokenProgram
      : tokenExtensionContext.tokenMintWithProgramB.tokenProgram;
    const settlementTokenProgram = settlementMint.equals(poolData.tokenMintA)
      ? tokenExtensionContext.tokenMintWithProgramA.tokenProgram
      : tokenExtensionContext.tokenMintWithProgramB.tokenProgram;
    if (
      (!inputTokenProgram.equals(TOKEN_PROGRAM_ID) &&
        !inputTokenProgram.equals(TOKEN_2022_PROGRAM_ID)) ||
      (!settlementTokenProgram.equals(TOKEN_PROGRAM_ID) &&
        !settlementTokenProgram.equals(TOKEN_2022_PROGRAM_ID))
    ) {
      throw new Error("Orca route contains an unsupported token program");
    }

    const routerInput = getAssociatedTokenAddressSync(
      inputMint,
      routerAuthority,
      true,
      inputTokenProgram,
    );
    const routerSettlement = getAssociatedTokenAddressSync(
      settlementMint,
      routerAuthority,
      true,
      settlementTokenProgram,
    );
    const baseParams = SwapUtils.getSwapParamsFromQuote(
      { ...quote, otherAmountThreshold: maxAmount(quote.otherAmountThreshold, input.minOut) },
      context,
      pool,
      routerInput,
      routerSettlement,
      routerAuthority,
    );
    const transferHookAccounts =
      await TokenExtensionUtil.getExtraAccountMetasForTransferHookForPool(
        input.connection,
        tokenExtensionContext,
        baseParams.aToB ? baseParams.tokenOwnerAccountA : baseParams.tokenVaultA,
        baseParams.aToB ? baseParams.tokenVaultA : baseParams.tokenOwnerAccountA,
        baseParams.aToB ? baseParams.tokenAuthority : baseParams.whirlpool,
        baseParams.aToB ? baseParams.tokenVaultB : baseParams.tokenOwnerAccountB,
        baseParams.aToB ? baseParams.tokenOwnerAccountB : baseParams.tokenVaultB,
        baseParams.aToB ? baseParams.whirlpool : baseParams.tokenAuthority,
      );
    const swap = WhirlpoolIx.swapV2Ix(context.program, {
      ...baseParams,
      tokenMintA: poolData.tokenMintA,
      tokenMintB: poolData.tokenMintB,
      tokenProgramA: tokenExtensionContext.tokenMintWithProgramA.tokenProgram,
      tokenProgramB: tokenExtensionContext.tokenMintWithProgramB.tokenProgram,
      ...(transferHookAccounts.tokenTransferHookAccountsA === undefined
        ? {}
        : { tokenTransferHookAccountsA: transferHookAccounts.tokenTransferHookAccountsA }),
      ...(transferHookAccounts.tokenTransferHookAccountsB === undefined
        ? {}
        : { tokenTransferHookAccountsB: transferHookAccounts.tokenTransferHookAccountsB }),
      ...(quote.supplementalTickArrays === undefined
        ? {}
        : { supplementalTickArrays: quote.supplementalTickArrays }),
    });
    const instruction = swap.instructions[0];
    if (instruction === undefined || swap.instructions.length !== 1) {
      throw new Error("Orca swap route must contain exactly one swap instruction");
    }

    return {
      route: {
        programId: instruction.programId.toBase58(),
        data: Uint8Array.from(instruction.data),
        accounts: instruction.keys.map((account) => ({ ...account })),
      },
      addressLookupTableAccounts: await lookupTableAccounts(
        input.connection,
        this.#addressLookupTables,
      ),
    };
  }
}

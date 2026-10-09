import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Percentage, type TransactionBuilder } from "@orca-so/common-sdk";
import {
  buildWhirlpoolClient,
  increaseLiquidityQuoteByInputToken,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PDAUtil,
  PoolUtil,
  SPLASH_POOL_TICK_SPACING,
  swapQuoteByInputToken,
  TickUtil,
  TokenExtensionUtil,
  WhirlpoolContext,
} from "@orca-so/whirlpools-sdk";
import {
  AuthorityType,
  createMint,
  getAccount,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  NATIVE_MINT,
  setAuthority,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";

const DEVNET_WHIRLPOOLS_CONFIG = new PublicKey("FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR");
const OFFICIAL_USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const SOL_USDC_WHIRLPOOL = new PublicKey("5GPCnpWwoDayCP5FVCJT1cS7dePufC5FrjPTVvPoUYnm");
const DECIMALS = 6;
const SURROGATE_SUPPLY = 1_000_000_000n;
const LIQUIDITY_INPUT = new Decimal("0.25");
const REQUIRED_USDC = 550_000n;
const SOL_FUNDING_INPUT = new BN(50_000_000);

type SurrogateSymbol = "devUSDG" | "devUSDT";

interface ProvisionedPool {
  readonly symbol: SurrogateSymbol;
  readonly mint: string;
  readonly mintTransaction: string | null;
  readonly pool: string;
  readonly poolTransaction: string | null;
  readonly position: string | null;
  readonly liquidityTransaction: string | null;
}

interface ResolvedSurrogate {
  readonly symbol: SurrogateSymbol;
  readonly mint: PublicKey;
  readonly signature: string | null;
}

function rpcUrl(): string {
  // SPL provisioning helpers confirm over websocket. Some read-optimized RPC
  // plans omit subscriptions, so operations use a separately overridable URL.
  return process.env.SOLANA_PROVISION_RPC_URL ?? "https://api.devnet.solana.com";
}

async function loadPayer(): Promise<Keypair> {
  const path =
    process.env.SOLANA_DEVNET_DEPLOYER_KEYPAIR ??
    new URL("../../../../.keys/solana-devnet-deployer.json", import.meta.url);
  return Keypair.fromSecretKey(Uint8Array.from((await Bun.file(path).json()) as number[]));
}

async function executeBuilder(
  connection: Connection,
  payer: Keypair,
  builder: TransactionBuilder,
): Promise<string> {
  const wallet = new Wallet(payer);
  const payload = await builder.build();
  const transaction = await wallet.signTransaction(payload.transaction);
  if (transaction instanceof VersionedTransaction) transaction.sign([...payload.signers]);
  else for (const signer of payload.signers) transaction.partialSign(signer);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    preflightCommitment: "confirmed",
  });
  for (let attempt = 0; attempt < 75; attempt += 1) {
    const status = (await connection.getSignatureStatuses([signature])).value[0];
    if (status?.err !== null && status?.err !== undefined) {
      throw new Error(`Transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return signature;
    }
    await Bun.sleep(1_000);
  }
  throw new Error(`Timed out confirming ${signature}`);
}

async function ensureUsdc(
  connection: Connection,
  payer: Keypair,
  context: WhirlpoolContext,
): Promise<string | null> {
  const account = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    OFFICIAL_USDC_MINT,
    payer.publicKey,
  );
  const balance = (await getAccount(connection, account.address)).amount;
  if (balance >= REQUIRED_USDC) return null;

  const pool = await buildWhirlpoolClient(context).getPool(SOL_USDC_WHIRLPOOL);
  const quote = await swapQuoteByInputToken(
    pool,
    NATIVE_MINT,
    SOL_FUNDING_INPUT,
    Percentage.fromFraction(100, 10_000),
    context.program.programId,
    context.fetcher,
  );
  return executeBuilder(connection, payer, await pool.swap(quote));
}

async function resolveSurrogateMint(
  connection: Connection,
  payer: Keypair,
  symbol: SurrogateSymbol,
): Promise<{ readonly mint: PublicKey; readonly signature: string | null }> {
  const variable =
    symbol === "devUSDG"
      ? "SOLANA_DEVNET_SURROGATE_USDG_MINT"
      : "SOLANA_DEVNET_SURROGATE_USDT_MINT";
  const configured = process.env[variable];
  if (configured !== undefined && configured.length > 0) {
    const mint = new PublicKey(configured);
    await getMint(connection, mint, "confirmed", TOKEN_PROGRAM_ID);
    return { mint, signature: null };
  }

  const mint = await createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    DECIMALS,
    undefined,
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID,
  );
  const account = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey);
  const signature = await mintTo(
    connection,
    payer,
    mint,
    account.address,
    payer,
    SURROGATE_SUPPLY,
    [],
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID,
  );
  return { mint, signature };
}

function poolAddress(mint: PublicKey): PublicKey {
  const [mintA, mintB] = PoolUtil.orderMints(mint, OFFICIAL_USDC_MINT);
  return PDAUtil.getWhirlpool(
    ORCA_WHIRLPOOL_PROGRAM_ID,
    DEVNET_WHIRLPOOLS_CONFIG,
    mintA,
    mintB,
    SPLASH_POOL_TICK_SPACING,
  ).publicKey;
}

async function needsLiquidity(
  connection: Connection,
  context: WhirlpoolContext,
  surrogate: ResolvedSurrogate,
): Promise<boolean> {
  const address = poolAddress(surrogate.mint);
  if ((await connection.getAccountInfo(address, "confirmed")) === null) return true;
  return (await buildWhirlpoolClient(context).getPool(address)).getData().liquidity.isZero();
}

async function provisionPool(
  connection: Connection,
  payer: Keypair,
  context: WhirlpoolContext,
  surrogate: ResolvedSurrogate,
): Promise<ProvisionedPool> {
  const client = buildWhirlpoolClient(context);
  const [mintA, mintB] = PoolUtil.orderMints(surrogate.mint, OFFICIAL_USDC_MINT);
  const planned = await client.createSplashPool(
    DEVNET_WHIRLPOOLS_CONFIG,
    mintA,
    mintB,
    new Decimal(1),
    payer.publicKey,
  );
  const exists = (await connection.getAccountInfo(planned.poolKey, "confirmed")) !== null;
  const poolTransaction = exists ? null : await executeBuilder(connection, payer, planned.tx);
  const pool = await client.getPool(planned.poolKey);
  if (!pool.getData().liquidity.isZero()) {
    return {
      symbol: surrogate.symbol,
      mint: surrogate.mint.toBase58(),
      mintTransaction: surrogate.signature,
      pool: planned.poolKey.toBase58(),
      poolTransaction,
      position: null,
      liquidityTransaction: null,
    };
  }

  const [tickLower, tickUpper] = TickUtil.getFullRangeTickIndex(SPLASH_POOL_TICK_SPACING);
  const tokenExtensions = await TokenExtensionUtil.buildTokenExtensionContext(
    context.fetcher,
    pool.getData(),
  );
  const quote = increaseLiquidityQuoteByInputToken(
    surrogate.mint,
    LIQUIDITY_INPUT,
    tickLower,
    tickUpper,
    Percentage.fromFraction(100, 10_000),
    pool,
    tokenExtensions,
  );
  const position = await pool.openPosition(
    tickLower,
    tickUpper,
    quote,
    payer.publicKey,
    payer.publicKey,
  );
  const liquidityTransaction = await executeBuilder(connection, payer, position.tx);
  return {
    symbol: surrogate.symbol,
    mint: surrogate.mint.toBase58(),
    mintTransaction: surrogate.signature,
    pool: planned.poolKey.toBase58(),
    poolTransaction,
    position: position.positionMint.toBase58(),
    liquidityTransaction,
  };
}

async function main(): Promise<void> {
  const connection = new Connection(rpcUrl(), "confirmed");
  const payer = await loadPayer();
  const context = WhirlpoolContext.withProvider(
    new AnchorProvider(connection, new Wallet(payer), AnchorProvider.defaultOptions()),
    ORCA_WHIRLPOOL_PROGRAM_ID,
  );
  const surrogates = await Promise.all(
    (["devUSDG", "devUSDT"] as const).map(async (symbol) => ({
      symbol,
      ...(await resolveSurrogateMint(connection, payer, symbol)),
    })),
  );
  const liquidityRequired = (
    await Promise.all(surrogates.map((surrogate) => needsLiquidity(connection, context, surrogate)))
  ).some(Boolean);
  const usdcFundingTransaction = liquidityRequired
    ? await ensureUsdc(connection, payer, context)
    : null;
  const pools: ProvisionedPool[] = [];
  for (const surrogate of surrogates) {
    pools.push(await provisionPool(connection, payer, context, surrogate));
  }
  for (const pool of pools) {
    if (pool.mintTransaction !== null) {
      await setAuthority(
        connection,
        payer,
        new PublicKey(pool.mint),
        payer,
        AuthorityType.MintTokens,
        null,
        [],
        { commitment: "confirmed" },
        TOKEN_PROGRAM_ID,
      );
    }
  }
  console.log(
    JSON.stringify({
      ok: true,
      network: "solana-devnet",
      backing: "surrogate test tokens with fixed supply; not Paxos USDG or Tether USDT",
      officialUsdc: OFFICIAL_USDC_MINT.toBase58(),
      usdcFundingTransaction,
      pools,
    }),
  );
}

await main();

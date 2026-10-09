import { randomBytes } from "node:crypto";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Percentage } from "@orca-so/common-sdk";
import {
  buildWhirlpoolClient,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  swapQuoteByInputToken,
  WhirlpoolContext,
} from "@orca-so/whirlpools-sdk";
import {
  getAccount,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  type Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  ORCA_DEVNET_PYUSD_MINT,
  ORCA_DEVNET_USDC_MINT,
  ORCA_DEVNET_USDC_PYUSD_WHIRLPOOL,
  OrcaSolanaRouteSource,
} from "../src/orca.ts";
import {
  encodeSolanaOrderMessage,
  LocalSolanaOrderSigner,
  type SolanaOrder,
} from "../src/order.ts";
import { buildCrossAssetSolanaPayment, paymentRouterAddresses } from "../src/payment.ts";

const PROGRAM_ID = "5raasGCxqaEvGsvQ1PvGxRB1JYnA7Y3L4LfjRCfkNJ4f";
const SOL_PYUSD_WHIRLPOOL = "8WLHU9LsezCo3DWdFk33rRPdybJabfZ7cBn9ZroWu11t";
const PAYMENT_INPUT_AMOUNT = 1_000_000n;
const PAYMENT_MIN_OUT = 900_000n;

function rpcUrl(): string {
  const urls = JSON.parse(process.env.CHAIN_RPC_URLS ?? "{}") as Record<string, string>;
  const value = urls["solana-devnet"] ?? process.env.SOLANA_RPC_URL;
  if (value === undefined || value.length === 0) throw new Error("Solana devnet RPC is missing");
  return value;
}

async function loadPayer(): Promise<Keypair> {
  const configured = process.env.SOLANA_DEVNET_DEPLOYER_KEYPAIR;
  const path =
    configured ?? new URL("../../../../.keys/solana-devnet-deployer.json", import.meta.url);
  const bytes = (await Bun.file(path).json()) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function orderSigner(): LocalSolanaOrderSigner {
  const encoded = process.env.SOLANA_ORDER_SIGNER_SECRET_KEY;
  if (encoded === undefined) throw new Error("SOLANA_ORDER_SIGNER_SECRET_KEY is missing");
  return new LocalSolanaOrderSigner(Uint8Array.from(Buffer.from(encoded, "base64")));
}

function deploymentDomain(): Uint8Array {
  const domains = JSON.parse(process.env.SOLANA_DEPLOYMENT_DOMAINS ?? "{}") as Record<
    string,
    string
  >;
  const value = domains["solana-devnet"]?.replace(/^0x/, "");
  if (value === undefined || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("Solana devnet deployment domain is missing");
  }
  return Uint8Array.from(Buffer.from(value, "hex"));
}

async function waitForSignature(connection: Connection, signature: string): Promise<void> {
  for (let attempt = 0; attempt < 75; attempt += 1) {
    const status = (await connection.getSignatureStatuses([signature])).value[0];
    if (status?.err !== null && status?.err !== undefined) {
      throw new Error(`Transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return;
    }
    await Bun.sleep(1_000);
  }
  throw new Error(`Timed out confirming ${signature}`);
}

async function sendLegacy(
  connection: Connection,
  transaction: Transaction,
  payer: Keypair,
): Promise<string> {
  transaction.sign(payer);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    preflightCommitment: "confirmed",
  });
  await waitForSignature(connection, signature);
  return signature;
}

async function tokenBalance(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgram: PublicKey,
): Promise<bigint> {
  const address = getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
  const info = await connection.getAccountInfo(address, "confirmed");
  return info === null
    ? 0n
    : (await getAccount(connection, address, "confirmed", tokenProgram)).amount;
}

async function fundPyusd(connection: Connection, payer: Keypair): Promise<string | null> {
  const pyusd = new PublicKey(ORCA_DEVNET_PYUSD_MINT);
  if (
    (await tokenBalance(connection, pyusd, payer.publicKey, TOKEN_2022_PROGRAM_ID)) >=
    PAYMENT_INPUT_AMOUNT
  ) {
    return null;
  }

  const context = WhirlpoolContext.withProvider(
    new AnchorProvider(connection, new Wallet(payer), AnchorProvider.defaultOptions()),
    ORCA_WHIRLPOOL_PROGRAM_ID,
  );
  const pool = await buildWhirlpoolClient(context).getPool(SOL_PYUSD_WHIRLPOOL);
  const quote = await swapQuoteByInputToken(
    pool,
    NATIVE_MINT,
    new BN(100_000_000),
    Percentage.fromFraction(100, 10_000),
    context.program.programId,
    context.fetcher,
  );
  const wallet = new Wallet(payer);
  const payload = await (await pool.swap(quote)).build();
  const transaction = await wallet.signTransaction(payload.transaction);
  if (transaction instanceof VersionedTransaction) {
    transaction.sign(payload.signers);
  } else {
    for (const signer of payload.signers) transaction.partialSign(signer);
  }
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    preflightCommitment: "confirmed",
  });
  await waitForSignature(connection, signature);
  return signature;
}

async function main(): Promise<void> {
  const connection = new Connection(rpcUrl(), "confirmed");
  const payer = await loadPayer();
  const signer = orderSigner();
  const fundingSignature = await fundPyusd(connection, payer);
  const settlementMint = new PublicKey(ORCA_DEVNET_USDC_MINT);
  const balanceBefore = await tokenBalance(
    connection,
    settlementMint,
    payer.publicKey,
    TOKEN_PROGRAM_ID,
  );
  const order: SolanaOrder = {
    intentId: Uint8Array.from(randomBytes(32)),
    settlementMint: settlementMint.toBase58(),
    minOut: PAYMENT_MIN_OUT,
    fee: 10_000n,
    merchant: payer.publicKey.toBase58(),
    refundTo: payer.publicKey.toBase58(),
    deadline: BigInt(Math.floor(Date.now() / 1_000) + 600),
  };
  const addresses = paymentRouterAddresses(PROGRAM_ID);
  const signature = await signer.sign(
    encodeSolanaOrderMessage({
      programId: PROGRAM_ID,
      config: addresses.config.toBase58(),
      deploymentDomain: deploymentDomain(),
      order,
    }),
  );
  const routeSource = new OrcaSolanaRouteSource({
    pools: [
      {
        address: ORCA_DEVNET_USDC_PYUSD_WHIRLPOOL,
        tokenMintA: ORCA_DEVNET_USDC_MINT,
        tokenMintB: ORCA_DEVNET_PYUSD_MINT,
      },
    ],
    addressLookupTables:
      (JSON.parse(process.env.SOLANA_ORCA_LOOKUP_TABLES ?? "{}") as Record<string, string[]>)[
        "solana-devnet"
      ] ?? [],
  });
  const executable = await routeSource.route({
    connection,
    paymentRouter: PROGRAM_ID,
    inputMint: ORCA_DEVNET_PYUSD_MINT,
    settlementMint: ORCA_DEVNET_USDC_MINT,
    inputAmount: PAYMENT_INPUT_AMOUNT,
    minOut: PAYMENT_MIN_OUT,
  });
  const built = await buildCrossAssetSolanaPayment({
    connection,
    programId: PROGRAM_ID,
    payer: payer.publicKey.toBase58(),
    feeRecipient: payer.publicKey.toBase58(),
    deploymentDomain: deploymentDomain(),
    order,
    inputAmount: PAYMENT_INPUT_AMOUNT,
    signature,
    signerPublicKey: signer.publicKey(),
    inputMint: ORCA_DEVNET_PYUSD_MINT,
    route: executable.route,
    addressLookupTableAccounts: executable.addressLookupTableAccounts,
  });
  const preparationSignatures: string[] = [];
  for (const transaction of built.preparationTransactions) {
    preparationSignatures.push(await sendLegacy(connection, transaction, payer));
  }
  const transaction = built.transaction;
  if (!(transaction instanceof VersionedTransaction)) {
    throw new Error("Cross-asset payment did not build a v0 transaction");
  }
  transaction.sign([payer]);
  const simulation = await connection.simulateTransaction(transaction, {
    commitment: "confirmed",
    sigVerify: true,
  });
  if (simulation.value.err !== null) {
    throw new Error(
      `Payment simulation failed: ${JSON.stringify(simulation.value.err)}\n${simulation.value.logs?.join("\n") ?? ""}`,
    );
  }
  const paymentSignature = await connection.sendTransaction(transaction, {
    preflightCommitment: "confirmed",
  });
  await waitForSignature(connection, paymentSignature);
  const balanceAfter = await tokenBalance(
    connection,
    settlementMint,
    payer.publicKey,
    TOKEN_PROGRAM_ID,
  );
  const received = balanceAfter - balanceBefore;
  if (received < PAYMENT_MIN_OUT) {
    throw new Error(`Settlement received ${received}, expected at least ${PAYMENT_MIN_OUT}`);
  }
  console.log(
    JSON.stringify({
      ok: true,
      inputAsset: "Orca devPYUSD (Token-2022)",
      settlementAsset: "Orca devUSDC",
      inputAmount: PAYMENT_INPUT_AMOUNT.toString(),
      selectedMinimumSettlement: PAYMENT_MIN_OUT.toString(),
      received: received.toString(),
      fundingSignature,
      preparationSignatures,
      paymentSignature,
    }),
  );
}

await main();

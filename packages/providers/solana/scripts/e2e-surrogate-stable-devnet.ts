import { randomBytes } from "node:crypto";
import { getAccount, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  type Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { OrcaSolanaRouteSource } from "../src/orca.ts";
import {
  encodeSolanaOrderMessage,
  LocalSolanaOrderSigner,
  type SolanaOrder,
} from "../src/order.ts";
import { buildCrossAssetSolanaPayment, paymentRouterAddresses } from "../src/payment.ts";

const PROGRAM_ID = "5raasGCxqaEvGsvQ1PvGxRB1JYnA7Y3L4LfjRCfkNJ4f";
const USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const PAYMENT_INPUT_AMOUNT = 10_000n;
const PAYMENT_MIN_OUT = 9_000n;

const SURROGATES = {
  USDG: {
    mint: "H1hMJToegAs8mXt23eVuwKJb17fz4N5emZBCzAvmBF6R",
    pool: "LkKtkAzT4kjfwv6objWTRXo4pLpBUmdEJyJ9Uy2zHsM",
  },
  USDT: {
    mint: "8PtqaCwyS3JT1JfJgkKsFnYRkftQLpRc2kvxebxMUuus",
    pool: "6L9dVPZZbvm4jGxPCgrKfiGsnJaQTS5562UEGcRVZyow",
  },
} as const;

type SurrogateAsset = keyof typeof SURROGATES;

function selectedAsset(): SurrogateAsset {
  const asset = process.env.SOLANA_E2E_SURROGATE_ASSET ?? "USDG";
  if (asset !== "USDG" && asset !== "USDT") {
    throw new Error("SOLANA_E2E_SURROGATE_ASSET must be USDG or USDT");
  }
  return asset;
}

function rpcUrl(): string {
  const urls = JSON.parse(process.env.CHAIN_RPC_URLS ?? "{}") as Record<string, string>;
  const value = urls["solana-devnet"] ?? process.env.SOLANA_RPC_URL;
  if (value === undefined || value.length === 0) throw new Error("Solana devnet RPC is missing");
  return value;
}

async function loadPayer(): Promise<Keypair> {
  const path =
    process.env.SOLANA_DEVNET_DEPLOYER_KEYPAIR ??
    new URL("../../../../.keys/solana-devnet-deployer.json", import.meta.url);
  return Keypair.fromSecretKey(Uint8Array.from((await Bun.file(path).json()) as number[]));
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

async function balance(connection: Connection, mint: string, owner: PublicKey): Promise<bigint> {
  const address = getAssociatedTokenAddressSync(
    new PublicKey(mint),
    owner,
    false,
    TOKEN_PROGRAM_ID,
  );
  const info = await connection.getAccountInfo(address, "confirmed");
  return info === null
    ? 0n
    : (await getAccount(connection, address, "confirmed", TOKEN_PROGRAM_ID)).amount;
}

async function main(): Promise<void> {
  const asset = selectedAsset();
  const surrogate = SURROGATES[asset];
  const connection = new Connection(rpcUrl(), "confirmed");
  const payer = await loadPayer();
  const signer = orderSigner();
  const inputBalance = await balance(connection, surrogate.mint, payer.publicKey);
  if (inputBalance < PAYMENT_INPUT_AMOUNT) {
    throw new Error(`${asset} surrogate balance ${inputBalance} is below the test payment`);
  }

  const usdcBefore = await balance(connection, USDC_MINT, payer.publicKey);
  const order: SolanaOrder = {
    intentId: Uint8Array.from(randomBytes(32)),
    settlementMint: USDC_MINT,
    minOut: PAYMENT_MIN_OUT,
    fee: 100n,
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
        address: surrogate.pool,
        tokenMintA: USDC_MINT,
        tokenMintB: surrogate.mint,
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
    inputMint: surrogate.mint,
    settlementMint: USDC_MINT,
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
    inputMint: surrogate.mint,
    route: executable.route,
    addressLookupTableAccounts: executable.addressLookupTableAccounts,
  });
  const preparationSignatures: string[] = [];
  for (const transaction of built.preparationTransactions) {
    preparationSignatures.push(await sendLegacy(connection, transaction, payer));
  }
  if (!(built.transaction instanceof VersionedTransaction)) {
    throw new Error("Cross-asset payment did not build a v0 transaction");
  }
  built.transaction.sign([payer]);
  const simulation = await connection.simulateTransaction(built.transaction, {
    commitment: "confirmed",
    sigVerify: true,
  });
  if (simulation.value.err !== null) {
    throw new Error(
      `Payment simulation failed: ${JSON.stringify(simulation.value.err)}\n${simulation.value.logs?.join("\n") ?? ""}`,
    );
  }
  const paymentSignature = await connection.sendTransaction(built.transaction, {
    preflightCommitment: "confirmed",
  });
  await waitForSignature(connection, paymentSignature);
  const received = (await balance(connection, USDC_MINT, payer.publicKey)) - usdcBefore;
  if (received < PAYMENT_MIN_OUT) {
    throw new Error(`Settlement received ${received}, expected at least ${PAYMENT_MIN_OUT}`);
  }
  console.log(
    JSON.stringify({
      ok: true,
      asset,
      surrogateMint: surrogate.mint,
      settlementMint: USDC_MINT,
      pool: surrogate.pool,
      inputAmount: PAYMENT_INPUT_AMOUNT.toString(),
      selectedMinimumSettlement: PAYMENT_MIN_OUT.toString(),
      received: received.toString(),
      preparationSignatures,
      paymentSignature,
    }),
  );
}

await main();

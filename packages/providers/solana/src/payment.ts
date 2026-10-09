import { createHash } from "node:crypto";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  type AccountMeta,
  type AddressLookupTableAccount,
  type Connection,
  Ed25519Program,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { encodeSolanaOrder, encodeSolanaOrderMessage, type SolanaOrder } from "./order.ts";

const CONFIG_SEED = Buffer.from("config");
const INTENT_SEED = Buffer.from("intent");
const INPUT_ASSET_SEED = Buffer.from("input-asset");
const SETTLEMENT_ASSET_SEED = Buffer.from("settlement-asset");
const AUTHORITY_SEED = Buffer.from("authority");
const ROUTER_SEED = Buffer.from("router");

function tokenProgramForMintOwner(owner: PublicKey | undefined): PublicKey {
  if (owner?.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  if (owner?.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  throw new Error("Mint is not owned by the SPL Token or Token-2022 program");
}

function discriminator(name: string): Uint8Array {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function u64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function join(parts: readonly Uint8Array[]): Buffer {
  return Buffer.concat(parts.map((part) => Buffer.from(part)));
}

export interface BuildDirectSolanaPayment {
  readonly connection: Connection;
  readonly programId: string;
  readonly payer: string;
  /** Pays ATA rent in preparation transactions. The payer still pays the router transaction. */
  readonly preparationFeePayer?: string;
  readonly feeRecipient: string;
  readonly deploymentDomain: Uint8Array;
  readonly order: SolanaOrder;
  readonly inputAmount: bigint;
  readonly signature: Uint8Array;
  readonly signerPublicKey: string;
}

export interface BuildCrossAssetSolanaPayment extends BuildDirectSolanaPayment {
  readonly inputMint: string;
  readonly route: SolanaSwapRoute;
  readonly addressLookupTableAccounts: readonly AddressLookupTableAccount[];
  /** Fund and sync the payer's WSOL account from native SOL when needed. */
  readonly wrapNativeInput?: boolean;
}

export interface BuiltSolanaPayment<
  TTransaction extends Transaction | VersionedTransaction = Transaction,
> {
  readonly preparationTransactions: readonly Transaction[];
  readonly preparationBase64: readonly string[];
  readonly transaction: TTransaction;
  readonly base64: string;
  readonly config: string;
  readonly consumedIntent: string;
}

export interface SolanaSwapRoute {
  readonly programId: string;
  readonly data: Uint8Array;
  readonly accounts: readonly AccountMeta[];
}

function preparationTransactions(input: {
  readonly payer: PublicKey;
  readonly blockhash: string;
  readonly instructions: readonly TransactionInstruction[];
}): readonly Transaction[] {
  const transactions: Transaction[] = [];
  // ATA creation is deliberately kept out of the signed payment transaction:
  // Ed25519 verification plus a swap route is already close to Solana's legacy
  // transaction size limit. Three ATA creates remain comfortably below it.
  for (let offset = 0; offset < input.instructions.length; offset += 3) {
    transactions.push(
      new Transaction({ feePayer: input.payer, recentBlockhash: input.blockhash }).add(
        ...input.instructions.slice(offset, offset + 3),
      ),
    );
  }
  return transactions;
}

export function paymentRouterAddresses(program: string): {
  readonly config: PublicKey;
  readonly routerAuthority: PublicKey;
};
export function paymentRouterAddresses(
  program: string,
  mint: string,
): {
  readonly config: PublicKey;
  readonly routerAuthority: PublicKey;
  readonly inputAsset: PublicKey;
  readonly settlementAsset: PublicKey;
};
export function paymentRouterAddresses(program: string, mint?: string) {
  const programId = new PublicKey(program);
  const [config] = PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
  const [routerAuthority] = PublicKey.findProgramAddressSync([AUTHORITY_SEED], programId);
  if (mint === undefined) return { config, routerAuthority };
  const mintKey = new PublicKey(mint);
  const [inputAsset] = PublicKey.findProgramAddressSync(
    [INPUT_ASSET_SEED, config.toBytes(), mintKey.toBytes()],
    programId,
  );
  const [settlementAsset] = PublicKey.findProgramAddressSync(
    [SETTLEMENT_ASSET_SEED, config.toBytes(), mintKey.toBytes()],
    programId,
  );
  return { config, routerAuthority, inputAsset, settlementAsset };
}

export function paymentRouterRouteAddress(program: string, routeProgram: string): PublicKey {
  const programId = new PublicKey(program);
  const config = paymentRouterAddresses(program).config;
  return PublicKey.findProgramAddressSync(
    [ROUTER_SEED, config.toBytes(), new PublicKey(routeProgram).toBytes()],
    programId,
  )[0];
}

export function initializePaymentRouterInstruction(input: {
  readonly programId: string;
  readonly admin: string;
  readonly guardian: string;
  readonly signer: string;
  readonly feeRecipient: string;
  readonly settlementMint: string;
  readonly deploymentDomain: Uint8Array;
}): TransactionInstruction {
  const programId = new PublicKey(input.programId);
  const mint = new PublicKey(input.settlementMint);
  const addresses = paymentRouterAddresses(input.programId, input.settlementMint);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: new PublicKey(input.admin), isSigner: true, isWritable: true },
      { pubkey: addresses.config, isSigner: false, isWritable: true },
      { pubkey: addresses.routerAuthority, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: addresses.settlementAsset, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: join([
      discriminator("initialize"),
      new PublicKey(input.guardian).toBytes(),
      new PublicKey(input.signer).toBytes(),
      new PublicKey(input.feeRecipient).toBytes(),
      input.deploymentDomain,
    ]),
  });
}

export function addInputAssetInstruction(input: {
  readonly programId: string;
  readonly admin: string;
  readonly mint: string;
}): TransactionInstruction {
  const programId = new PublicKey(input.programId);
  const addresses = paymentRouterAddresses(input.programId, input.mint);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: new PublicKey(input.admin), isSigner: true, isWritable: true },
      { pubkey: addresses.config, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(input.mint), isSigner: false, isWritable: false },
      { pubkey: addresses.inputAsset, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(discriminator("add_input_asset")),
  });
}

export function removeInputAssetInstruction(input: {
  readonly programId: string;
  readonly admin: string;
  readonly mint: string;
}): TransactionInstruction {
  const programId = new PublicKey(input.programId);
  const addresses = paymentRouterAddresses(input.programId, input.mint);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: new PublicKey(input.admin), isSigner: true, isWritable: true },
      { pubkey: addresses.config, isSigner: false, isWritable: false },
      { pubkey: addresses.inputAsset, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(discriminator("remove_input_asset")),
  });
}

export function addSettlementAssetInstruction(input: {
  readonly programId: string;
  readonly admin: string;
  readonly mint: string;
}): TransactionInstruction {
  const programId = new PublicKey(input.programId);
  const addresses = paymentRouterAddresses(input.programId, input.mint);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: new PublicKey(input.admin), isSigner: true, isWritable: true },
      { pubkey: addresses.config, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(input.mint), isSigner: false, isWritable: false },
      { pubkey: addresses.settlementAsset, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(discriminator("add_settlement_asset")),
  });
}

export function removeSettlementAssetInstruction(input: {
  readonly programId: string;
  readonly admin: string;
  readonly mint: string;
}): TransactionInstruction {
  const programId = new PublicKey(input.programId);
  const addresses = paymentRouterAddresses(input.programId, input.mint);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: new PublicKey(input.admin), isSigner: true, isWritable: true },
      { pubkey: addresses.config, isSigner: false, isWritable: false },
      { pubkey: addresses.settlementAsset, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(discriminator("remove_settlement_asset")),
  });
}

export function addSwapRouterInstruction(input: {
  readonly programId: string;
  readonly admin: string;
  readonly routeProgram: string;
}): TransactionInstruction {
  const programId = new PublicKey(input.programId);
  const config = paymentRouterAddresses(input.programId).config;
  const routeProgram = new PublicKey(input.routeProgram);
  const router = paymentRouterRouteAddress(input.programId, input.routeProgram);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: new PublicKey(input.admin), isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: routeProgram, isSigner: false, isWritable: false },
      { pubkey: router, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(discriminator("add_router")),
  });
}

export async function buildDirectSolanaPayment(
  input: BuildDirectSolanaPayment,
): Promise<BuiltSolanaPayment<Transaction>> {
  const programId = new PublicKey(input.programId);
  const payer = new PublicKey(input.payer);
  const preparationFeePayer = new PublicKey(input.preparationFeePayer ?? input.payer);
  const feeRecipient = new PublicKey(input.feeRecipient);
  const mint = new PublicKey(input.order.settlementMint);
  const merchant = new PublicKey(input.order.merchant);
  const refundTo = new PublicKey(input.order.refundTo);
  const mintInfo = await input.connection.getAccountInfo(mint, "confirmed");
  const tokenProgram = tokenProgramForMintOwner(mintInfo?.owner);
  const [config] = PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
  const [consumedIntent] = PublicKey.findProgramAddressSync(
    [INTENT_SEED, config.toBytes(), input.order.intentId],
    programId,
  );
  const [inputAsset] = PublicKey.findProgramAddressSync(
    [INPUT_ASSET_SEED, config.toBytes(), mint.toBytes()],
    programId,
  );
  const [settlementAsset] = PublicKey.findProgramAddressSync(
    [SETTLEMENT_ASSET_SEED, config.toBytes(), mint.toBytes()],
    programId,
  );
  const message = encodeSolanaOrderMessage({
    programId: programId.toBase58(),
    config: config.toBase58(),
    deploymentDomain: input.deploymentDomain,
    order: input.order,
  });
  const verify = Ed25519Program.createInstructionWithPublicKey({
    publicKey: new PublicKey(input.signerPublicKey).toBytes(),
    message,
    signature: input.signature,
  });
  const merchantToken = getAssociatedTokenAddressSync(mint, merchant, true, tokenProgram);
  const feeToken = getAssociatedTokenAddressSync(mint, feeRecipient, true, tokenProgram);
  const refundToken = getAssociatedTokenAddressSync(mint, refundTo, true, tokenProgram);
  const destinations = [
    { address: merchantToken, owner: merchant },
    { address: feeToken, owner: feeRecipient },
    { address: refundToken, owner: refundTo },
  ].filter(
    (entry, index, entries) =>
      entries.findIndex((candidate) => candidate.address.equals(entry.address)) === index,
  );
  const destinationAccounts = await input.connection.getMultipleAccountsInfo(
    destinations.map((entry) => entry.address),
    "confirmed",
  );
  const createDestinations = destinations.flatMap((entry, index) =>
    destinationAccounts[index] === null
      ? [
          createAssociatedTokenAccountIdempotentInstruction(
            preparationFeePayer,
            entry.address,
            entry.owner,
            mint,
            tokenProgram,
          ),
        ]
      : [],
  );
  const pay = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: consumedIntent, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: inputAsset, isSigner: false, isWritable: false },
      { pubkey: settlementAsset, isSigner: false, isWritable: false },
      {
        pubkey: getAssociatedTokenAddressSync(mint, payer, false, tokenProgram),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: merchantToken,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: feeToken,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: refundToken,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: join([discriminator("pay_spl"), encodeSolanaOrder(input.order), u64(input.inputAmount)]),
  });
  const { blockhash } = await input.connection.getLatestBlockhash("confirmed");
  const preparations = preparationTransactions({
    payer: preparationFeePayer,
    blockhash,
    instructions: createDestinations,
  });
  const transaction = new Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(
    verify,
    pay,
  );
  return {
    preparationTransactions: preparations,
    preparationBase64: preparations.map((preparation) =>
      preparation
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64"),
    ),
    transaction,
    base64: transaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
    config: config.toBase58(),
    consumedIntent: consumedIntent.toBase58(),
  };
}

export async function buildCrossAssetSolanaPayment(
  input: BuildCrossAssetSolanaPayment,
): Promise<BuiltSolanaPayment<VersionedTransaction>> {
  const programId = new PublicKey(input.programId);
  const payer = new PublicKey(input.payer);
  const preparationFeePayer = new PublicKey(input.preparationFeePayer ?? input.payer);
  const feeRecipient = new PublicKey(input.feeRecipient);
  const inputMint = new PublicKey(input.inputMint);
  const settlementMint = new PublicKey(input.order.settlementMint);
  const merchant = new PublicKey(input.order.merchant);
  const refundTo = new PublicKey(input.order.refundTo);
  const routeProgram = new PublicKey(input.route.programId);
  const mintInfos = await input.connection.getMultipleAccountsInfo(
    [inputMint, settlementMint],
    "confirmed",
  );
  const inputTokenProgram = tokenProgramForMintOwner(mintInfos[0]?.owner);
  const settlementTokenProgram = tokenProgramForMintOwner(mintInfos[1]?.owner);
  const [config] = PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
  const [routerAuthority] = PublicKey.findProgramAddressSync([AUTHORITY_SEED], programId);
  const [consumedIntent] = PublicKey.findProgramAddressSync(
    [INTENT_SEED, config.toBytes(), input.order.intentId],
    programId,
  );
  const [inputAsset] = PublicKey.findProgramAddressSync(
    [INPUT_ASSET_SEED, config.toBytes(), inputMint.toBytes()],
    programId,
  );
  const [settlementAsset] = PublicKey.findProgramAddressSync(
    [SETTLEMENT_ASSET_SEED, config.toBytes(), settlementMint.toBytes()],
    programId,
  );
  const [router] = PublicKey.findProgramAddressSync(
    [ROUTER_SEED, config.toBytes(), routeProgram.toBytes()],
    programId,
  );
  const message = encodeSolanaOrderMessage({
    programId: programId.toBase58(),
    config: config.toBase58(),
    deploymentDomain: input.deploymentDomain,
    order: input.order,
  });
  const verify = Ed25519Program.createInstructionWithPublicKey({
    publicKey: new PublicKey(input.signerPublicKey).toBytes(),
    message,
    signature: input.signature,
  });
  const payerInput = getAssociatedTokenAddressSync(inputMint, payer, false, inputTokenProgram);
  const refundInput = getAssociatedTokenAddressSync(inputMint, refundTo, true, inputTokenProgram);
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
  const merchantSettlement = getAssociatedTokenAddressSync(
    settlementMint,
    merchant,
    true,
    settlementTokenProgram,
  );
  const feeSettlement = getAssociatedTokenAddressSync(
    settlementMint,
    feeRecipient,
    true,
    settlementTokenProgram,
  );
  const refundSettlement = getAssociatedTokenAddressSync(
    settlementMint,
    refundTo,
    true,
    settlementTokenProgram,
  );
  const requiredAccounts = [
    { address: payerInput, owner: payer, mint: inputMint, tokenProgram: inputTokenProgram },
    { address: refundInput, owner: refundTo, mint: inputMint, tokenProgram: inputTokenProgram },
    {
      address: routerInput,
      owner: routerAuthority,
      mint: inputMint,
      tokenProgram: inputTokenProgram,
    },
    {
      address: routerSettlement,
      owner: routerAuthority,
      mint: settlementMint,
      tokenProgram: settlementTokenProgram,
    },
    {
      address: merchantSettlement,
      owner: merchant,
      mint: settlementMint,
      tokenProgram: settlementTokenProgram,
    },
    {
      address: feeSettlement,
      owner: feeRecipient,
      mint: settlementMint,
      tokenProgram: settlementTokenProgram,
    },
    {
      address: refundSettlement,
      owner: refundTo,
      mint: settlementMint,
      tokenProgram: settlementTokenProgram,
    },
  ].filter(
    (entry, index, entries) =>
      entries.findIndex((candidate) => candidate.address.equals(entry.address)) === index,
  );
  const accountInfos = await input.connection.getMultipleAccountsInfo(
    requiredAccounts.map((entry) => entry.address),
    "confirmed",
  );
  const createAccounts = requiredAccounts.flatMap((entry, index) =>
    accountInfos[index] === null
      ? [
          createAssociatedTokenAccountIdempotentInstruction(
            preparationFeePayer,
            entry.address,
            entry.owner,
            entry.mint,
            entry.tokenProgram,
          ),
        ]
      : [],
  );
  const payerInputIndex = requiredAccounts.findIndex((entry) => entry.address.equals(payerInput));
  const wrappedBalance =
    inputMint.equals(NATIVE_MINT) && accountInfos[payerInputIndex] !== null
      ? (await getAccount(input.connection, payerInput, "confirmed", inputTokenProgram)).amount
      : 0n;
  const wrapAmount = input.inputAmount > wrappedBalance ? input.inputAmount - wrappedBalance : 0n;
  const wrapNative =
    inputMint.equals(NATIVE_MINT) && input.wrapNativeInput !== false && wrapAmount > 0n
      ? [
          SystemProgram.transfer({
            fromPubkey: payer,
            toPubkey: payerInput,
            lamports: wrapAmount,
          }),
          createSyncNativeInstruction(payerInput, inputTokenProgram),
        ]
      : [];
  const pay = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: consumedIntent, isSigner: false, isWritable: true },
      { pubkey: routerAuthority, isSigner: false, isWritable: false },
      { pubkey: inputMint, isSigner: false, isWritable: false },
      { pubkey: settlementMint, isSigner: false, isWritable: false },
      { pubkey: inputAsset, isSigner: false, isWritable: false },
      { pubkey: settlementAsset, isSigner: false, isWritable: false },
      { pubkey: routeProgram, isSigner: false, isWritable: false },
      { pubkey: router, isSigner: false, isWritable: false },
      { pubkey: payerInput, isSigner: false, isWritable: true },
      { pubkey: refundInput, isSigner: false, isWritable: true },
      { pubkey: routerInput, isSigner: false, isWritable: true },
      { pubkey: routerSettlement, isSigner: false, isWritable: true },
      { pubkey: merchantSettlement, isSigner: false, isWritable: true },
      { pubkey: feeSettlement, isSigner: false, isWritable: true },
      { pubkey: refundSettlement, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: inputTokenProgram, isSigner: false, isWritable: false },
      { pubkey: settlementTokenProgram, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      // Route signer privileges are established by the router's invoke_signed
      // CPI. Carrying them into the outer wallet instruction would require an
      // impossible transaction signature from the router-authority PDA.
      ...input.route.accounts.map((account) => ({ ...account, isSigner: false })),
    ],
    data: join([
      discriminator("pay_spl_with_swap"),
      encodeSolanaOrder(input.order),
      u64(input.inputAmount),
      u32(input.route.data.length),
      input.route.data,
    ]),
  });
  const { blockhash } = await input.connection.getLatestBlockhash("confirmed");
  const preparations = preparationTransactions({
    payer: preparationFeePayer,
    blockhash,
    instructions: [...createAccounts, ...wrapNative],
  });
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: [verify, pay],
    }).compileToV0Message([...input.addressLookupTableAccounts]),
  );
  return {
    preparationTransactions: preparations,
    preparationBase64: preparations.map((preparation) =>
      preparation
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64"),
    ),
    transaction,
    base64: Buffer.from(transaction.serialize()).toString("base64"),
    config: config.toBase58(),
    consumedIntent: consumedIntent.toBase58(),
  };
}

export const SOLANA_TOKEN_PROGRAM_ID = TOKEN_PROGRAM_ID;
export const SOLANA_TOKEN_2022_PROGRAM_ID = TOKEN_2022_PROGRAM_ID;
export const SOLANA_ASSOCIATED_TOKEN_PROGRAM_ID = ASSOCIATED_TOKEN_PROGRAM_ID;
/** Native SOL enters the SPL-only router through this canonical wrapped mint. */
export const SOLANA_WRAPPED_NATIVE_MINT = NATIVE_MINT.toBase58();

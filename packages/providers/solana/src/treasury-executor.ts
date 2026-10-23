import type { ChainId } from "@mayarin/chain";
import type {
  ExecuteRequest,
  ExecutionResult,
  SweepRequest,
  TreasuryExecutionPort,
} from "@mayarin/clearing";
import {
  type AssetCode,
  ConfigurationError,
  money,
  ProviderError,
  ValidationError,
} from "@mayarin/shared";
import { Keypair, SystemProgram, Transaction, type VersionedTransaction } from "@solana/web3.js";
import { deriveSolanaDepositKeypair } from "./deposit-address.ts";
import type { OrcaRouteResult } from "./orca.ts";
import { intentIdFromHex, type SolanaOrder } from "./order.ts";
import {
  buildCrossAssetSolanaPayment,
  buildDirectSolanaPayment,
  SOLANA_WRAPPED_NATIVE_MINT,
} from "./payment.ts";
import { paymentCompletedFromLogs, type SolanaConnection } from "./settlements.ts";

export interface SolanaDepositIndexLookup {
  indexFor(clearingTransactionId: string): Promise<number | undefined>;
}

export interface SolanaTreasuryRouteSource {
  route(input: {
    readonly chain: ChainId;
    readonly connection: SolanaConnection;
    readonly paymentRouter: string;
    readonly payer: string;
    readonly inputMint: string;
    readonly settlementMint: string;
    readonly inputAmount: bigint;
    readonly minOut: bigint;
  }): Promise<OrcaRouteResult>;
}

export interface SolanaTreasuryExecutionPortOptions {
  readonly connections: Readonly<Partial<Record<ChainId, SolanaConnection>>>;
  readonly depositSeed: Uint8Array;
  readonly feePayer: Keypair;
  readonly lookup: SolanaDepositIndexLookup;
  readonly paymentRouters: Readonly<Partial<Record<ChainId, string>>>;
  readonly deploymentDomains: Readonly<Partial<Record<ChainId, Uint8Array>>>;
  readonly feeRecipients: Readonly<Partial<Record<ChainId, string>>>;
  readonly tokens: Readonly<Partial<Record<ChainId, Readonly<Partial<Record<AssetCode, string>>>>>>;
  readonly nativeAssets: Readonly<Partial<Record<ChainId, AssetCode>>>;
  readonly routeSources?: Readonly<Partial<Record<ChainId, SolanaTreasuryRouteSource>>>;
}

type SignableTransaction = Transaction | VersionedTransaction;
const CONSUMED_INTENT_SPACE = 81;
const PAYMENT_FEE_RESERVE_LAMPORTS = 20_000;

function keypairFromSecret(secret: Uint8Array): Keypair {
  if (secret.length === 32) return Keypair.fromSeed(secret);
  if (secret.length === 64) return Keypair.fromSecretKey(secret);
  throw new ConfigurationError("Solana fee-payer secret must contain 32 or 64 bytes", {});
}

export function solanaKeypairFromSecret(secret: Uint8Array): Keypair {
  return keypairFromSecret(secret);
}

/** Executes a plain Solana deposit through the same PaymentRouter used by wallet checkout. */
export class SolanaTreasuryExecutionPort implements TreasuryExecutionPort {
  readonly #options: SolanaTreasuryExecutionPortOptions;

  constructor(options: SolanaTreasuryExecutionPortOptions) {
    this.#options = options;
  }

  async sweep(request: SweepRequest): Promise<undefined> {
    const payer = await this.#payerFor(request.clearingTransactionId);
    if (payer.publicKey.toBase58() !== request.depositAddress) {
      throw new ValidationError(
        `Derived Solana deposit owner does not match ${request.depositAddress}`,
        { clearingTransactionId: request.clearingTransactionId, chain: request.chain },
      );
    }
    // Solana has no CREATE2 forwarder. The derived owner signs the router call
    // directly; the separately configured fee payer supplies SOL and ATA rent.
    const connection = this.#required(this.#options.connections, request.chain, "RPC connection");
    const rent = await connection.getMinimumBalanceForRentExemption(CONSUMED_INTENT_SPACE);
    // The owner pays the payment fee too, so whatever is left after the fee must
    // itself be rent-exempt, or the runtime rejects the payment with
    // "insufficient funds for rent".
    const ownerRent = await connection.getMinimumBalanceForRentExemption(0);
    const required = rent + ownerRent + PAYMENT_FEE_RESERVE_LAMPORTS;
    const balance = await connection.getBalance(payer.publicKey, "confirmed");
    if (balance >= required) return undefined;

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const funding = new Transaction({
      feePayer: this.#options.feePayer.publicKey,
      recentBlockhash: blockhash,
    }).add(
      SystemProgram.transfer({
        fromPubkey: this.#options.feePayer.publicKey,
        toPubkey: payer.publicKey,
        lamports: required - balance,
      }),
    );
    await this.#submit(connection, funding, payer);
    return undefined;
  }

  async execute(request: ExecuteRequest): Promise<ExecutionResult> {
    const connection = this.#required(this.#options.connections, request.chain, "RPC connection");
    const paymentRouter = this.#required(
      this.#options.paymentRouters,
      request.chain,
      "PaymentRouter",
    );
    const deploymentDomain = this.#required(
      this.#options.deploymentDomains,
      request.chain,
      "deployment domain",
    );
    const feeRecipient = this.#required(
      this.#options.feeRecipients,
      request.chain,
      "fee recipient",
    );
    const payer = await this.#payerFor(request.clearingTransactionId);
    const inputMint = this.#mintFor(request.chain, request.inputAmount.asset);
    const settlementAsset = this.#assetForMint(request.chain, request.order.settlementToken);
    const order: SolanaOrder = {
      intentId: intentIdFromHex(request.order.intentId),
      settlementMint: request.order.settlementToken,
      minOut: request.order.minOut,
      fee: request.order.fee,
      merchant: request.order.merchantSafe,
      refundTo: request.order.refundTo,
      deadline: request.order.deadline,
    };
    const common = {
      connection,
      programId: paymentRouter,
      payer: payer.publicKey.toBase58(),
      preparationFeePayer: this.#options.feePayer.publicKey.toBase58(),
      feeRecipient,
      deploymentDomain,
      order,
      inputAmount: request.inputAmount.amount,
      signature: Uint8Array.from(Buffer.from(request.order.signature, "base64")),
      signerPublicKey: request.order.signer,
    } as const;
    const built =
      inputMint === request.order.settlementToken
        ? await buildDirectSolanaPayment(common)
        : await this.#crossAsset({
            ...common,
            chain: request.chain,
            inputMint,
          });

    for (const preparation of built.preparationTransactions) {
      await this.#submit(connection, preparation, payer);
    }
    const txHash = await this.#submit(connection, built.transaction, payer);
    const transaction = await this.#confirmedTransaction(connection, txHash);
    const event = paymentCompletedFromLogs(transaction?.meta?.logMessages ?? []);
    if (event === undefined) {
      throw new ProviderError(
        `Solana payment ${txHash} emitted no PaymentCompleted event`,
        { chain: request.chain, txHash },
        { retryable: false },
      );
    }
    const output = event.settledAmount + event.fee + event.refundAmount;
    const gasAsset = this.#options.nativeAssets[request.chain];
    return {
      txHash,
      output: money(output, settlementAsset),
      ...(gasAsset === undefined || transaction?.meta == null
        ? {}
        : { gasCost: money(BigInt(transaction.meta.fee), gasAsset) }),
    };
  }

  async #crossAsset(
    input: Parameters<typeof buildDirectSolanaPayment>[0] & {
      readonly chain: ChainId;
      readonly inputMint: string;
    },
  ) {
    const source = this.#required(
      this.#options.routeSources ?? {},
      input.chain,
      "Orca route source",
    );
    const executable = await source.route({
      chain: input.chain,
      connection: input.connection,
      paymentRouter: input.programId,
      payer: input.payer,
      inputMint: input.inputMint,
      settlementMint: input.order.settlementMint,
      inputAmount: input.inputAmount,
      minOut: input.order.minOut,
    });
    return buildCrossAssetSolanaPayment({
      ...input,
      route: executable.route,
      addressLookupTableAccounts: executable.addressLookupTableAccounts,
    });
  }

  async #payerFor(clearingTransactionId: string): Promise<Keypair> {
    const index = await this.#options.lookup.indexFor(clearingTransactionId);
    if (index === undefined) {
      throw new ConfigurationError(
        `No derivation index recorded for Solana deposit ${clearingTransactionId}`,
        { clearingTransactionId },
      );
    }
    return deriveSolanaDepositKeypair(this.#options.depositSeed, index);
  }

  async #submit(
    connection: SolanaConnection,
    transaction: SignableTransaction,
    payer: Keypair,
  ): Promise<string> {
    try {
      if ("partialSign" in transaction) {
        const message = transaction.compileMessage();
        const required = message.accountKeys.slice(0, message.header.numRequiredSignatures);
        if (required.some((key) => key.equals(this.#options.feePayer.publicKey))) {
          transaction.partialSign(this.#options.feePayer);
        }
        if (required.some((key) => key.equals(payer.publicKey))) transaction.partialSign(payer);
      } else {
        const required = transaction.message.staticAccountKeys.slice(
          0,
          transaction.message.header.numRequiredSignatures,
        );
        const signers = [this.#options.feePayer, payer].filter(
          (candidate, index, candidates) =>
            required.some((key) => key.equals(candidate.publicKey)) &&
            candidates.findIndex((keypair) => keypair.publicKey.equals(candidate.publicKey)) ===
              index,
        );
        transaction.sign(signers);
      }
      const txHash = await connection.sendRawTransaction(transaction.serialize());
      // Poll over HTTP: confirmTransaction opens a signatureSubscribe websocket,
      // which RPCs such as Alchemy reject, so it never resolves there.
      for (let attempt = 0; attempt < 60; attempt++) {
        const status = (await connection.getSignatureStatuses([txHash])).value[0];
        if (status?.err !== null && status?.err !== undefined) {
          throw new Error(JSON.stringify(status.err));
        }
        if (
          status?.confirmationStatus === "confirmed" ||
          status?.confirmationStatus === "finalized"
        ) {
          return txHash;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      throw new Error(`Timed out confirming ${txHash}`);
    } catch (error) {
      throw new ProviderError(
        `Submitting Solana treasury payment failed: ${error instanceof Error ? error.message : String(error)}`,
        {},
        { cause: error, retryable: true },
      );
    }
  }

  async #confirmedTransaction(connection: SolanaConnection, txHash: string) {
    // Some public RPCs acknowledge confirmation before the indexed transaction
    // is readable. Re-submitting here is unsafe because the router has already
    // consumed the intent, so wait for the original receipt instead.
    for (let attempt = 0; attempt < 25; attempt++) {
      const transaction = await connection.getTransaction(txHash, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (transaction !== null) return transaction;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new ProviderError(
      `Confirmed Solana payment ${txHash} is not yet readable from RPC`,
      { txHash },
      { retryable: false },
    );
  }

  #mintFor(chain: ChainId, asset: AssetCode): string {
    if (this.#options.nativeAssets[chain] === asset) return SOLANA_WRAPPED_NATIVE_MINT;
    return this.#required(this.#options.tokens[chain] ?? {}, asset, `${asset} mint`);
  }

  #assetForMint(chain: ChainId, mint: string): AssetCode {
    const found = Object.entries(this.#options.tokens[chain] ?? {}).find(
      ([, address]) => address === mint,
    );
    if (found === undefined) {
      throw new ConfigurationError(`No settlement asset configured for Solana mint ${mint}`, {
        chain,
        mint,
      });
    }
    return found[0] as AssetCode;
  }

  #required<T>(values: Readonly<Partial<Record<string, T>>>, key: string, label: string): T {
    const value = values[key];
    if (value === undefined) {
      throw new ConfigurationError(`No Solana ${label} configured for ${key}`, { key, label });
    }
    return value;
  }
}

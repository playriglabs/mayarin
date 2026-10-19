import type {
  AssetBalance,
  BalanceQuery,
  BlockRef,
  ChainClient,
  ChainId,
  SettlementLog,
  SettlementQuery,
  TransferLog,
  TransferQuery,
} from "@mayarin/chain";
import { type AssetCode, type Clock, systemClock } from "@mayarin/shared";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { type Connection, PublicKey } from "@solana/web3.js";

export interface SolanaDepositClientOptions {
  readonly connection: Connection;
  readonly tokens: Readonly<Partial<Record<AssetCode, string>>>;
  readonly nativeAsset?: AssetCode;
  readonly clock?: Clock;
}

/**
 * How long one `head` answer is reused. The watcher ticks once per asset, all
 * within a second or two of each other, and the payment status endpoint asks
 * on every poll: without this each of them pays a `getSlot`.
 */
export const HEAD_TTL_MS = 2_000;

/**
 * Slots a watcher tick may cover on Solana. Solana finds a deposit by the
 * signatures of its address, not by walking blocks, so a window costs the same
 * lookup however wide it is. At the EVM-sized 2000 (100 for the native asset) a
 * watcher that was down for a few days made hundreds of thousands of identical
 * lookups to cross the gap, and a deposit made meanwhile sat unseen until the
 * scan reached it. This is about 46 days of slots: one tick crosses any gap.
 */
export const SOLANA_SCAN_RANGE = 10_000_000;

/** `getSignaturesForAddress` returns at most this many per call. */
const SIGNATURES_PER_PAGE = 1_000;
/** A single-use deposit address has a handful; this many pages means something is wrong. */
const MAX_SIGNATURE_PAGES = 20;

/** `getMultipleAccounts` takes at most 100 keys. */
const ACCOUNTS_PER_CALL = 100;

export class SolanaDepositClient implements ChainClient {
  readonly #connection: Connection;
  readonly #tokens: SolanaDepositClientOptions["tokens"];
  readonly #nativeAsset: AssetCode;
  readonly #tokenPrograms = new Map<string, PublicKey>();
  readonly #clock: Clock;
  #head: { readonly at: number; readonly block: Promise<BlockRef> } | undefined;

  constructor(options: SolanaDepositClientOptions) {
    this.#connection = options.connection;
    this.#tokens = options.tokens;
    this.#nativeAsset = options.nativeAsset ?? "SOL";
    this.#clock = options.clock ?? systemClock;
  }

  head(_chain: ChainId): Promise<BlockRef> {
    const now = this.#clock.now().getTime();
    if (this.#head !== undefined && now - this.#head.at < HEAD_TTL_MS) return this.#head.block;
    const block = this.#readHead();
    this.#head = { at: now, block };
    // A failed read must not be served for the next two seconds.
    block.catch(() => {
      if (this.#head?.block === block) this.#head = undefined;
    });
    return block;
  }

  /**
   * The slot only. A `getBlock` for the hash, retried back through up to 32
   * slots because the newest confirmed slot often has no block yet, was
   * the largest single cost on the RPC bill (44%); nothing reads a head's hash.
   */
  async #readHead(): Promise<BlockRef> {
    return { number: BigInt(await this.#connection.getSlot("confirmed")) };
  }

  async blockHash(_chain: ChainId, number: bigint): Promise<string | null> {
    const block = await this.#connection.getBlock(Number(number), {
      commitment: "confirmed",
      transactionDetails: "none",
      rewards: false,
      maxSupportedTransactionVersion: 0,
    });
    return block?.blockhash ?? null;
  }

  async transfers(query: TransferQuery): Promise<TransferLog[]> {
    const destinations = await Promise.all(
      query.addresses.map(async (owner) => ({
        owner,
        account: await this.#depositAccount(query.asset, owner),
      })),
    );
    // A deposit address nobody has paid yet has no account on chain. Asking
    // for the signatures of each one costs a call per address per tick, and
    // most addresses are unpaid, so one batched read decides which to look at.
    const funded = await this.#existing(destinations.map(({ account }) => account));
    const transfers = await Promise.all(
      destinations
        .filter(({ account }) => funded.has(account.toBase58()))
        .map(async ({ owner, account }) => {
          const signatures = await this.#signatures(account, query.fromBlock);
          const inRange = signatures.filter(
            (entry) =>
              entry.err === null &&
              BigInt(entry.slot) >= query.fromBlock &&
              BigInt(entry.slot) <= query.toBlock,
          );
          return Promise.all(
            inRange.map(async (entry) => {
              const transaction = await this.#connection.getParsedTransaction(entry.signature, {
                commitment: "confirmed",
                maxSupportedTransactionVersion: 0,
              });
              if (transaction === null || transaction.meta?.err !== null) return [];
              const keys = transaction.transaction.message.accountKeys.map((key) => key.pubkey);
              const accountIndex = keys.findIndex((key) => key.equals(account));
              if (accountIndex < 0) return [];
              const amount =
                query.asset === this.#nativeAsset
                  ? BigInt(transaction.meta.postBalances[accountIndex] ?? 0) -
                    BigInt(transaction.meta.preBalances[accountIndex] ?? 0)
                  : this.#tokenDelta(transaction.meta, accountIndex);
              if (amount <= 0n) return [];
              const blockHash = await this.blockHash(query.chain, BigInt(entry.slot));
              if (blockHash === null) return [];
              const sender = transaction.transaction.message.accountKeys.find((key) => key.signer);
              return [
                {
                  chain: query.chain,
                  asset: query.asset,
                  txHash: entry.signature,
                  logIndex: accountIndex,
                  blockNumber: BigInt(entry.slot),
                  blockHash,
                  from: sender?.pubkey.toBase58() ?? "11111111111111111111111111111111",
                  to: owner,
                  amount,
                } satisfies TransferLog,
              ];
            }),
          );
        }),
    );
    return transfers.flat(2);
  }

  async balances(_query: BalanceQuery): Promise<AssetBalance[]> {
    // Solana RPC cannot pin balance reads to an historical slot. Transfer
    // scanning remains reorg-classifiable; pretending a current balance came
    // from `query.block` would not be.
    return [];
  }

  async settlements(_query: SettlementQuery): Promise<SettlementLog[]> {
    return [];
  }

  /**
   * Every signature of an account back to `fromBlock`, newest first. A page is
   * full when there may be more, and the next one starts before its oldest.
   */
  async #signatures(account: PublicKey, fromBlock: bigint) {
    const found: Awaited<ReturnType<Connection["getSignaturesForAddress"]>> = [];
    let before: string | undefined;
    for (let page = 0; page < MAX_SIGNATURE_PAGES; page += 1) {
      const batch = await this.#connection.getSignaturesForAddress(
        account,
        { limit: SIGNATURES_PER_PAGE, ...(before === undefined ? {} : { before }) },
        "confirmed",
      );
      found.push(...batch);
      const oldest = batch.at(-1);
      if (batch.length < SIGNATURES_PER_PAGE || oldest === undefined) return found;
      if (BigInt(oldest.slot) < fromBlock) return found;
      before = oldest.signature;
    }
    throw new Error(
      `${account.toBase58()} has more than ${MAX_SIGNATURE_PAGES * SIGNATURES_PER_PAGE} signatures in range`,
    );
  }

  /** The accounts that exist, read without their data. */
  async #existing(accounts: readonly PublicKey[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (let start = 0; start < accounts.length; start += ACCOUNTS_PER_CALL) {
      const batch = accounts.slice(start, start + ACCOUNTS_PER_CALL);
      const infos = await this.#connection.getMultipleAccountsInfo(batch, {
        commitment: "confirmed",
        dataSlice: { offset: 0, length: 0 },
      });
      batch.forEach((account, index) => {
        if (infos[index] !== null) found.add(account.toBase58());
      });
    }
    return found;
  }

  async #depositAccount(asset: AssetCode, owner: string): Promise<PublicKey> {
    const ownerKey = new PublicKey(owner);
    if (asset === this.#nativeAsset) return ownerKey;
    const mintAddress = this.#tokens[asset];
    if (mintAddress === undefined) throw new Error(`No Solana mint configured for ${asset}`);
    const mint = new PublicKey(mintAddress);
    const tokenProgram = await this.#tokenProgram(mint);
    return getAssociatedTokenAddressSync(mint, ownerKey, false, tokenProgram);
  }

  async #tokenProgram(mint: PublicKey): Promise<PublicKey> {
    const key = mint.toBase58();
    const cached = this.#tokenPrograms.get(key);
    if (cached !== undefined) return cached;
    const owner = (await this.#connection.getAccountInfo(mint, "confirmed"))?.owner;
    if (
      owner === undefined ||
      (!owner.equals(TOKEN_PROGRAM_ID) && !owner.equals(TOKEN_2022_PROGRAM_ID))
    ) {
      throw new Error(`Solana mint ${key} is not owned by a supported token program`);
    }
    this.#tokenPrograms.set(key, owner);
    return owner;
  }

  #tokenDelta(
    meta: NonNullable<NonNullable<Awaited<ReturnType<Connection["getParsedTransaction"]>>>["meta"]>,
    accountIndex: number,
  ): bigint {
    const amount = (balances: typeof meta.preTokenBalances): bigint =>
      BigInt(
        balances?.find((balance) => balance.accountIndex === accountIndex)?.uiTokenAmount.amount ??
          "0",
      );
    return amount(meta.postTokenBalances) - amount(meta.preTokenBalances);
  }
}

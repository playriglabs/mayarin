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
 * within a second or two of each other, and every tick asks for the head:
 * without this each asset pays a `getSlot` and a `getBlock` for the same slot.
 */
export const HEAD_TTL_MS = 2_000;

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

  async #readHead(): Promise<BlockRef> {
    let slot = await this.#connection.getSlot("confirmed");
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const block = await this.#connection.getBlock(slot, {
        commitment: "confirmed",
        transactionDetails: "none",
        rewards: false,
        maxSupportedTransactionVersion: 0,
      });
      if (block !== null) return { number: BigInt(slot), hash: block.blockhash };
      slot -= 1;
    }
    throw new Error("No recent confirmed Solana block is available");
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
          const signatures = await this.#connection.getSignaturesForAddress(
            account,
            { limit: 1_000 },
            "confirmed",
          );
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

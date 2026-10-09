import { type ChainId, isSolanaChainId } from "@mayarin/chain";
import { type AssetCode, type Money, money, ProviderError } from "@mayarin/shared";
import type { WalletBalanceQuery, WalletBalanceReader } from "@mayarin/wallet";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";

export interface SolanaWalletBalanceReaderOptions {
  readonly rpcUrls: Readonly<Partial<Record<ChainId, string>>>;
  readonly tokens: Readonly<Partial<Record<ChainId, Readonly<Partial<Record<AssetCode, string>>>>>>;
  readonly nativeAssets?: Readonly<Partial<Record<ChainId, AssetCode>>>;
}

/** Latest native and associated-token balances for a merchant-owned Solana address. */
export class SolanaWalletBalanceReader implements WalletBalanceReader {
  readonly #options: SolanaWalletBalanceReaderOptions;
  readonly #connections = new Map<ChainId, Connection>();
  readonly #tokenPrograms = new Map<string, PublicKey>();

  constructor(options: SolanaWalletBalanceReaderOptions) {
    this.#options = options;
  }

  async balances(query: WalletBalanceQuery): Promise<readonly Money[]> {
    if (!isSolanaChainId(query.chain)) {
      throw new ProviderError(`${query.chain} is not a Solana chain`, { chain: query.chain });
    }
    const connection = this.#connection(query.chain);
    const owner = new PublicKey(query.address);
    const native = this.#options.nativeAssets?.[query.chain];

    return (
      await Promise.all(
        query.assets.map(async (asset): Promise<Money | undefined> => {
          if (asset === native) {
            return money(
              BigInt(await this.#read(connection.getBalance(owner, "confirmed"))),
              asset,
            );
          }
          const mintAddress = this.#options.tokens[query.chain]?.[asset];
          if (mintAddress === undefined) return undefined;
          const mint = new PublicKey(mintAddress);
          const tokenProgram = await this.#tokenProgram(connection, mint);
          const account = getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
          const info = await this.#read(connection.getAccountInfo(account, "confirmed"));
          if (info === null) return money(0n, asset);
          const balance = await this.#read(connection.getTokenAccountBalance(account, "confirmed"));
          return money(BigInt(balance.value.amount), asset);
        }),
      )
    ).filter((balance): balance is Money => balance !== undefined);
  }

  #connection(chain: ChainId): Connection {
    const cached = this.#connections.get(chain);
    if (cached !== undefined) return cached;
    const url = this.#options.rpcUrls[chain];
    if (url === undefined) throw new ProviderError(`No RPC URL configured for ${chain}`, { chain });
    const connection = new Connection(url, "confirmed");
    this.#connections.set(chain, connection);
    return connection;
  }

  async #tokenProgram(connection: Connection, mint: PublicKey): Promise<PublicKey> {
    const key = mint.toBase58();
    const cached = this.#tokenPrograms.get(key);
    if (cached !== undefined) return cached;
    const owner = (await this.#read(connection.getAccountInfo(mint, "confirmed")))?.owner;
    if (
      owner === undefined ||
      (!owner.equals(TOKEN_PROGRAM_ID) && !owner.equals(TOKEN_2022_PROGRAM_ID))
    ) {
      throw new ProviderError(`Solana mint ${key} is not owned by a supported token program`, {
        mint: key,
      });
    }
    this.#tokenPrograms.set(key, owner);
    return owner;
  }

  async #read<T>(promise: Promise<T>): Promise<T> {
    try {
      return await promise;
    } catch (error) {
      throw new ProviderError(
        `Reading a Solana wallet balance failed: ${error instanceof Error ? error.message : String(error)}`,
        {},
        { cause: error, retryable: true },
      );
    }
  }
}

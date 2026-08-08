/**
 * Reference in-memory fake for the wallet port, in a segregated `/testing`
 * subpath so domain `src/` stays pure.
 *
 * Mirrors the Postgres invariant the guard depends on: one wallet per address
 * per chain. A fake that let two merchants claim one address would let a test
 * pass that the real adapter cannot.
 */

import type { ChainId } from "@mayarin/chain";
import { ConflictError } from "@mayarin/shared";
import type {
  MerchantWallet,
  MerchantWalletRepository,
  WalletChallenge,
  WalletChallengeRepository,
} from "../src/index.ts";

export class InMemoryMerchantWalletRepository implements MerchantWalletRepository {
  readonly #byId = new Map<string, MerchantWallet>();

  async insert(wallet: MerchantWallet): Promise<void> {
    const existing = await this.findByAddress(wallet.chain, wallet.address);
    if (existing !== null) {
      throw new ConflictError(`${wallet.address} on ${wallet.chain} is already claimed`, {
        chain: wallet.chain,
        address: wallet.address,
      });
    }
    this.#byId.set(wallet.id, wallet);
  }

  async update(wallet: MerchantWallet): Promise<void> {
    this.#byId.set(wallet.id, wallet);
  }

  async findById(id: string): Promise<MerchantWallet | null> {
    return this.#byId.get(id) ?? null;
  }

  async findByMerchant(merchantId: string, chain: ChainId): Promise<MerchantWallet | null> {
    for (const wallet of this.#byId.values()) {
      if (wallet.merchantId === merchantId && wallet.chain === chain) return wallet;
    }
    return null;
  }

  async findByAddress(chain: ChainId, address: string): Promise<MerchantWallet | null> {
    const normalised = address.toLowerCase();
    for (const wallet of this.#byId.values()) {
      if (wallet.chain === chain && wallet.address === normalised) return wallet;
    }
    return null;
  }

  async listByMerchant(merchantId: string): Promise<readonly MerchantWallet[]> {
    return [...this.#byId.values()].filter((wallet) => wallet.merchantId === merchantId);
  }
}

/**
 * In-memory challenges.
 *
 * `consume` reports whether *this* call was the one that used it, mirroring the
 * conditional update the Postgres adapter relies on — a fake that let two calls
 * both succeed would hide the race the real one prevents.
 */
export class InMemoryWalletChallengeRepository implements WalletChallengeRepository {
  readonly #byId = new Map<string, WalletChallenge>();
  readonly #consumed = new Set<string>();

  async insert(challenge: WalletChallenge): Promise<void> {
    this.#byId.set(challenge.id, challenge);
  }

  async findById(id: string): Promise<WalletChallenge | null> {
    return this.#byId.get(id) ?? null;
  }

  async consume(id: string): Promise<boolean> {
    if (this.#consumed.has(id)) return false;
    this.#consumed.add(id);
    return true;
  }
}

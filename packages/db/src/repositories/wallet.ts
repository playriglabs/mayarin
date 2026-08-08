/**
 * Postgres adapters for the merchant-wallet ports (#11).
 *
 * Addresses are lowercased on the way in and compared lowercased on the way
 * out. Case is not a way past the guard, and a unique index over a mixed-case
 * column would let the same address be claimed twice.
 */

import type { ChainId } from "@mayarin/chain";
import type {
  MerchantWallet,
  MerchantWalletRepository,
  WalletChallenge,
  WalletChallengeRepository,
  WalletProvenance,
} from "@mayarin/wallet";
import { and, eq, isNull } from "drizzle-orm";
import type { Executor } from "../client.ts";
import { present } from "../mapping.ts";
import { merchantWallets, walletChallenges } from "../schema.ts";

type WalletRow = typeof merchantWallets.$inferSelect;
type ChallengeRow = typeof walletChallenges.$inferSelect;

export class DrizzleMerchantWalletRepository implements MerchantWalletRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async insert(wallet: MerchantWallet): Promise<void> {
    await this.#db.insert(merchantWallets).values(toWalletRow(wallet));
  }

  async update(wallet: MerchantWallet): Promise<void> {
    await this.#db
      .update(merchantWallets)
      .set(toWalletRow(wallet))
      .where(eq(merchantWallets.id, wallet.id));
  }

  async findById(id: string): Promise<MerchantWallet | null> {
    const [row] = await this.#db
      .select()
      .from(merchantWallets)
      .where(eq(merchantWallets.id, id))
      .limit(1);
    return row === undefined ? null : toWallet(row);
  }

  async findByMerchant(merchantId: string, chain: ChainId): Promise<MerchantWallet | null> {
    const [row] = await this.#db
      .select()
      .from(merchantWallets)
      .where(and(eq(merchantWallets.merchantId, merchantId), eq(merchantWallets.chain, chain)))
      .limit(1);
    return row === undefined ? null : toWallet(row);
  }

  async findByAddress(chain: ChainId, address: string): Promise<MerchantWallet | null> {
    const [row] = await this.#db
      .select()
      .from(merchantWallets)
      .where(
        and(eq(merchantWallets.chain, chain), eq(merchantWallets.address, address.toLowerCase())),
      )
      .limit(1);
    return row === undefined ? null : toWallet(row);
  }

  async listByMerchant(merchantId: string): Promise<readonly MerchantWallet[]> {
    const rows = await this.#db
      .select()
      .from(merchantWallets)
      .where(eq(merchantWallets.merchantId, merchantId));
    return rows.map(toWallet);
  }
}

export class DrizzleWalletChallengeRepository implements WalletChallengeRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async insert(challenge: WalletChallenge): Promise<void> {
    await this.#db.insert(walletChallenges).values({
      id: challenge.id,
      merchantId: challenge.merchantId,
      chain: challenge.chain,
      address: challenge.address.toLowerCase(),
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
      consumedAt: null,
      createdAt: challenge.createdAt,
    });
  }

  async findById(id: string): Promise<WalletChallenge | null> {
    const [row] = await this.#db
      .select()
      .from(walletChallenges)
      .where(eq(walletChallenges.id, id))
      .limit(1);
    return row === undefined ? null : toChallenge(row);
  }

  /**
   * Marks a challenge used, and reports whether this call is the one that did.
   *
   * Conditional on `consumed_at IS NULL` so two concurrent verifications cannot
   * both succeed off one signature — the database decides, not a read-then-write
   * that can interleave.
   */
  async consume(id: string): Promise<boolean> {
    const consumed = await this.#db
      .update(walletChallenges)
      .set({ consumedAt: new Date() })
      .where(and(eq(walletChallenges.id, id), isNull(walletChallenges.consumedAt)))
      .returning({ id: walletChallenges.id });
    return consumed.length > 0;
  }
}

function toWalletRow(wallet: MerchantWallet): typeof merchantWallets.$inferInsert {
  return {
    id: wallet.id,
    merchantId: wallet.merchantId,
    chain: wallet.chain,
    address: wallet.address.toLowerCase(),
    provenance: wallet.provenance,
    verifiedAt: wallet.verifiedAt ?? null,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
  };
}

function toWallet(row: WalletRow): MerchantWallet {
  return {
    id: row.id,
    merchantId: row.merchantId,
    chain: row.chain as ChainId,
    address: row.address,
    provenance: row.provenance as WalletProvenance,
    ...present("verifiedAt", row.verifiedAt),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toChallenge(row: ChallengeRow): WalletChallenge {
  return {
    id: row.id,
    merchantId: row.merchantId,
    chain: row.chain as ChainId,
    address: row.address,
    nonce: row.nonce,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

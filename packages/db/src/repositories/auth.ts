/**
 * Drizzle auth repositories.
 *
 * Implement the `@mayarin/auth` ports against Postgres. Optional fields cross
 * the null/undefined boundary through the `present()` helper, never by assigning
 * `undefined` to a column — the same convention the other repos follow.
 */

import type {
  Merchant,
  MerchantRepository,
  Permission,
  Session,
  SessionRepository,
  User,
  UserRepository,
} from "@mayarin/auth";
import type { MerchantAssetPolicy, MerchantAssetPolicySource } from "@mayarin/payment-intent";
import { type AssetCode, ConflictError, isAssetCode, ValidationError } from "@mayarin/shared";
import { eq, lt } from "drizzle-orm";
import type { Executor } from "../client.ts";
import { present } from "../mapping.ts";
import { merchants, sessions, users } from "../schema.ts";

type UserRow = typeof users.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;
type MerchantRow = typeof merchants.$inferSelect;

export class DrizzleUserRepository implements UserRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async insert(user: User): Promise<User> {
    try {
      await this.#db.insert(users).values(toUserRow(user));
    } catch (error) {
      throw toConflict(error, user.email);
    }
    return user;
  }

  async findById(id: string): Promise<User | null> {
    const [row] = await this.#db.select().from(users).where(eq(users.id, id)).limit(1);
    return row === undefined ? null : toUser(row);
  }

  async findByEmail(email: string): Promise<User | null> {
    const [row] = await this.#db.select().from(users).where(eq(users.email, email)).limit(1);
    return row === undefined ? null : toUser(row);
  }

  async listByMerchant(merchantId: string): Promise<readonly User[]> {
    const rows = await this.#db.select().from(users).where(eq(users.merchantId, merchantId));
    return rows.map(toUser);
  }

  async touchUpdatedAt(id: string, updatedAt: Date): Promise<void> {
    await this.#db.update(users).set({ updatedAt }).where(eq(users.id, id));
  }
}

export class DrizzleMerchantRepository implements MerchantRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async insert(merchant: Merchant): Promise<Merchant> {
    try {
      await this.#db.insert(merchants).values(toMerchantRow(merchant));
    } catch (error) {
      throw toConflict(error, merchant.id);
    }
    return merchant;
  }

  async findById(id: string): Promise<Merchant | null> {
    const [row] = await this.#db.select().from(merchants).where(eq(merchants.id, id)).limit(1);
    return row === undefined ? null : toMerchant(row);
  }

  async list(): Promise<readonly Merchant[]> {
    const rows = await this.#db.select().from(merchants);
    return rows.map(toMerchant);
  }
}

export class DrizzleSessionRepository implements SessionRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async insert(session: Session): Promise<Session> {
    await this.#db.insert(sessions).values(toSessionRow(session));
    return session;
  }

  async findById(id: string): Promise<Session | null> {
    const [row] = await this.#db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
    return row === undefined ? null : toSession(row);
  }

  async revoke(id: string, revokedAt: Date): Promise<void> {
    await this.#db.update(sessions).set({ revokedAt }).where(eq(sessions.id, id));
  }

  async deleteExpired(now: Date): Promise<number> {
    const deleted = await this.#db
      .delete(sessions)
      .where(lt(sessions.expiresAt, now))
      .returning({ id: sessions.id });
    return deleted.length;
  }
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    merchantId: row.merchantId,
    permissions: row.permissions as Permission[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toUserRow(user: User): typeof users.$inferInsert {
  return {
    id: user.id,
    email: user.email,
    passwordHash: user.passwordHash,
    merchantId: user.merchantId,
    permissions: [...user.permissions],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * Reads a merchant's asset policy for the payment intent service.
 *
 * A thin projection of the merchant record rather than a second table: the
 * policy is two of its columns, and the intent service should not have to know
 * that the record also carries a name and timestamps — or depend on
 * `@mayarin/auth` to find out.
 */
export class DrizzleMerchantAssetPolicySource implements MerchantAssetPolicySource {
  readonly #merchants: MerchantRepository;

  constructor(merchants: MerchantRepository) {
    this.#merchants = merchants;
  }

  async policyFor(merchantId: string): Promise<MerchantAssetPolicy | undefined> {
    const merchant = await this.#merchants.findById(merchantId);
    if (merchant === null) return undefined;
    return {
      settlementAsset: merchant.settlementAsset,
      acceptedAssets: merchant.acceptedAssets,
      ...present("settlementAddress", merchant.settlementAddress ?? null),
    };
  }
}

function toMerchant(row: MerchantRow): Merchant {
  return {
    id: row.id,
    name: row.name,
    settlementAsset: assertAssetCode(row.settlementAsset, row.id),
    acceptedAssets: row.acceptedAssets.map((asset) => assertAssetCode(asset, row.id)),
    ...present("settlementAddress", row.settlementAddress),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Postgres stores these as free text, so a code that left the registry — or a
 * hand-edited row — would otherwise flow into pricing as a valid asset.
 */
function assertAssetCode(value: string, merchantId: string): AssetCode {
  if (!isAssetCode(value)) {
    throw new ValidationError(`Merchant ${merchantId} names an unknown asset "${value}"`, {
      merchantId,
      asset: value,
    });
  }
  return value;
}

function toMerchantRow(merchant: Merchant): typeof merchants.$inferInsert {
  return {
    id: merchant.id,
    name: merchant.name,
    settlementAsset: merchant.settlementAsset,
    acceptedAssets: [...merchant.acceptedAssets],
    settlementAddress: merchant.settlementAddress ?? null,
    createdAt: merchant.createdAt,
    updatedAt: merchant.updatedAt,
  };
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.userId,
    csrfToken: row.csrfToken,
    expiresAt: row.expiresAt,
    ...present("revokedAt", row.revokedAt),
    createdAt: row.createdAt,
  };
}

function toSessionRow(session: Session): typeof sessions.$inferInsert {
  return {
    id: session.id,
    userId: session.userId,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt ?? null,
    createdAt: session.createdAt,
  };
}

/** Maps a Postgres unique-violation on `email`/merchant id to a domain `ConflictError`. */
function toConflict(error: unknown, key: string): unknown {
  if (error instanceof Error && /unique|duplicate key/i.test(error.message)) {
    return new ConflictError(`Already exists: ${key}`, { key });
  }
  return error;
}

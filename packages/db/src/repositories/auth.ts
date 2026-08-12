/**
 * Drizzle auth repositories.
 *
 * Implement the `@mayarin/auth` ports against Postgres. Optional fields cross
 * the null/undefined boundary through the `present()` helper, never by assigning
 * `undefined` to a column — the same convention the other repos follow.
 */

import type {
  ApiKey,
  ApiKeyRepository,
  Merchant,
  MerchantAccountRepository,
  MerchantRepository,
  MerchantSettingChange,
  MerchantSettingChangeRepository,
  MerchantSettingField,
  Permission,
  Session,
  SessionRepository,
  User,
  UserRepository,
} from "@mayarin/auth";
import type { MerchantAssetPolicy, MerchantAssetPolicySource } from "@mayarin/payment-intent";
import {
  type AssetCode,
  ConcurrencyError,
  ConflictError,
  isAssetCode,
  ValidationError,
} from "@mayarin/shared";
import { and, desc, eq, lt } from "drizzle-orm";
import type { Executor } from "../client.ts";
import { present, runInTransaction } from "../mapping.ts";
import { merchantApiKeys, merchantSettingChanges, merchants, sessions, users } from "../schema.ts";

type UserRow = typeof users.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;
type MerchantRow = typeof merchants.$inferSelect;
type ApiKeyRow = typeof merchantApiKeys.$inferSelect;

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

  /**
   * Optimistic update: the row only moves if it is still at the version the
   * caller read, so two concurrent settlement-address edits cannot silently
   * overwrite one another.
   */
  async update(merchant: Merchant, expectedVersion: number): Promise<void> {
    const updated = await this.#db
      .update(merchants)
      .set(toMerchantRow(merchant))
      .where(and(eq(merchants.id, merchant.id), eq(merchants.version, expectedVersion)))
      .returning({ id: merchants.id });

    if (updated.length === 0) {
      throw new ConcurrencyError(`Merchant ${merchant.id} was modified concurrently`, {
        id: merchant.id,
        expectedVersion,
      });
    }
  }
}

/**
 * Append-only settings audit (#95).
 *
 * Exposes no update and no delete, matching the port. A settlement-address
 * change is a redirect of a merchant's money; a trail that can be rewritten
 * records nothing worth having.
 */
export class DrizzleMerchantSettingChangeRepository implements MerchantSettingChangeRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async append(changes: readonly MerchantSettingChange[]): Promise<void> {
    if (changes.length === 0) return;
    await this.#db.insert(merchantSettingChanges).values(
      changes.map((change) => ({
        id: change.id,
        merchantId: change.merchantId,
        userId: change.userId,
        field: change.field,
        previousValue: change.previousValue ?? null,
        nextValue: change.nextValue ?? null,
        changedAt: change.changedAt,
      })),
    );
  }

  async list(merchantId: string, limit = 100): Promise<readonly MerchantSettingChange[]> {
    const rows = await this.#db
      .select()
      .from(merchantSettingChanges)
      .where(eq(merchantSettingChanges.merchantId, merchantId))
      .orderBy(desc(merchantSettingChanges.changedAt))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      merchantId: row.merchantId,
      userId: row.userId,
      field: row.field as MerchantSettingField,
      ...present("previousValue", row.previousValue),
      ...present("nextValue", row.nextValue),
      changedAt: row.changedAt,
    }));
  }
}

/**
 * The merchant and its first account, written together (issue #100).
 *
 * Postgres rolls the merchant back when the user insert raises, so a duplicate
 * email leaves nothing behind. Before this, it left a merchant no account could
 * ever sign in to — and the operator, seeing the error, reasonably assumed the
 * write had not happened.
 */
export class DrizzleMerchantAccountRepository implements MerchantAccountRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async insertWithFirstUser(merchant: Merchant, user: User): Promise<void> {
    try {
      await runInTransaction(this.#db, async (tx) => {
        await tx.insert(merchants).values(toMerchantRow(merchant));
        await tx.insert(users).values(toUserRow(user));
      });
    } catch (error) {
      // The email is the key an operator recognises. The merchant id is freshly
      // generated and unique by construction, so a conflict here is the user
      // row every time.
      throw toConflict(error, user.email);
    }
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
    ...present("city", row.city),
    ...present("countryCode", row.countryCode),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
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
    city: merchant.city ?? null,
    countryCode: merchant.countryCode ?? null,
    createdAt: merchant.createdAt,
    updatedAt: merchant.updatedAt,
    version: merchant.version,
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

export class DrizzleApiKeyRepository implements ApiKeyRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async insert(key: ApiKey): Promise<void> {
    await this.#db.insert(merchantApiKeys).values(toApiKeyRow(key));
  }

  async findById(id: string): Promise<ApiKey | null> {
    const [row] = await this.#db
      .select()
      .from(merchantApiKeys)
      .where(eq(merchantApiKeys.id, id))
      .limit(1);
    return row === undefined ? null : toApiKey(row);
  }

  async findBySecretHash(secretHash: string): Promise<ApiKey | null> {
    const [row] = await this.#db
      .select()
      .from(merchantApiKeys)
      .where(eq(merchantApiKeys.secretHash, secretHash))
      .limit(1);
    return row === undefined ? null : toApiKey(row);
  }

  async listByMerchant(merchantId: string): Promise<readonly ApiKey[]> {
    const rows = await this.#db
      .select()
      .from(merchantApiKeys)
      .where(eq(merchantApiKeys.merchantId, merchantId))
      .orderBy(desc(merchantApiKeys.createdAt));
    return rows.map(toApiKey);
  }

  async updateLastUsed(id: string, lastUsedAt: Date): Promise<void> {
    await this.#db.update(merchantApiKeys).set({ lastUsedAt }).where(eq(merchantApiKeys.id, id));
  }

  async update(key: ApiKey, expectedVersion: number): Promise<void> {
    const updated = await this.#db
      .update(merchantApiKeys)
      .set(toApiKeyRow(key))
      .where(and(eq(merchantApiKeys.id, key.id), eq(merchantApiKeys.version, expectedVersion)))
      .returning({ id: merchantApiKeys.id });

    if (updated.length === 0) {
      throw new ConcurrencyError(`API key ${key.id} was modified concurrently`, {
        id: key.id,
        expectedVersion,
      });
    }
  }
}

function toApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    merchantId: row.merchantId,
    kind: row.kind as ApiKey["kind"],
    name: row.name,
    secretHash: row.secretHash,
    prefix: row.prefix,
    permissions: row.permissions as Permission[],
    ...present("lastUsedAt", row.lastUsedAt),
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function toApiKeyRow(key: ApiKey): typeof merchantApiKeys.$inferInsert {
  return {
    id: key.id,
    merchantId: key.merchantId,
    kind: key.kind,
    name: key.name,
    secretHash: key.secretHash,
    prefix: key.prefix,
    permissions: [...key.permissions],
    lastUsedAt: key.lastUsedAt ?? null,
    active: key.active,
    createdAt: key.createdAt,
    updatedAt: key.updatedAt,
    version: key.version,
  };
}

/**
 * Reference in-memory fakes for the auth ports, shipped in a segregated
 * `/testing` subpath so domain `src/` stays pure.
 *
 * Mirror the Postgres invariants — unique email, unique session id — so tests
 * exercise the same failure modes without a database. Expiry is not enforced
 * here: the session service checks `expiresAt` against the clock, so a repo
 * returns the row and the service decides whether it is still live.
 */

import { ConcurrencyError, ConflictError } from "@mayarin/shared";
import type {
  ApiKey,
  ApiKeyRepository,
  EmailVerification,
  EmailVerificationRepository,
  Merchant,
  MerchantAccountRepository,
  MerchantRepository,
  MerchantSettingChange,
  MerchantSettingChangeRepository,
  Session,
  SessionRepository,
  User,
  UserRepository,
} from "../src/index.ts";

export class InMemoryUserRepository implements UserRepository {
  readonly #byId = new Map<string, User>();
  readonly #byEmail = new Map<string, string>();

  async insert(user: User): Promise<User> {
    if (this.#byId.has(user.id)) {
      throw new ConflictError(`User ${user.id} already exists`, { id: user.id });
    }
    if (this.#byEmail.has(user.email)) {
      throw new ConflictError(`A user with email "${user.email}" already exists`, {
        email: user.email,
      });
    }
    this.#byId.set(user.id, user);
    this.#byEmail.set(user.email, user.id);
    return user;
  }

  async findById(id: string): Promise<User | null> {
    return this.#byId.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const id = this.#byEmail.get(email);
    return id === undefined ? null : (this.#byId.get(id) ?? null);
  }

  async listByMerchant(merchantId: string): Promise<readonly User[]> {
    return [...this.#byId.values()].filter((user) => user.merchantId === merchantId);
  }

  async touchUpdatedAt(id: string, updatedAt: Date): Promise<void> {
    const user = this.#byId.get(id);
    if (user === undefined) return;
    this.#byId.set(id, { ...user, updatedAt });
  }

  async markEmailVerified(id: string, verifiedAt: Date): Promise<void> {
    const user = this.#byId.get(id);
    if (user === undefined) return;
    this.#byId.set(id, { ...user, emailVerifiedAt: verifiedAt, updatedAt: verifiedAt });
  }
}

export class InMemoryEmailVerificationRepository implements EmailVerificationRepository {
  readonly #rows: EmailVerification[] = [];

  async insert(verification: EmailVerification): Promise<void> {
    this.#rows.push(verification);
  }

  async findLiveByUser(userId: string, now: Date): Promise<EmailVerification | null> {
    const live = this.#rows
      .filter(
        (row) =>
          row.userId === userId &&
          row.consumedAt === undefined &&
          row.expiresAt.getTime() > now.getTime(),
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    return live[0] ?? null;
  }

  async recordAttempt(id: string, attempts: number): Promise<void> {
    this.#replace(id, (row) => ({ ...row, attempts }));
  }

  async markConsumed(id: string, consumedAt: Date): Promise<void> {
    this.#replace(id, (row) => ({ ...row, consumedAt }));
  }

  async consumeAllForUser(userId: string, consumedAt: Date): Promise<void> {
    for (const [index, row] of this.#rows.entries()) {
      if (row.userId !== userId || row.consumedAt !== undefined) continue;
      this.#rows[index] = { ...row, consumedAt };
    }
  }

  #replace(id: string, edit: (row: EmailVerification) => EmailVerification): void {
    const index = this.#rows.findIndex((row) => row.id === id);
    if (index === -1) return;
    const row = this.#rows[index];
    if (row === undefined) return;
    this.#rows[index] = edit(row);
  }
}

export class InMemoryMerchantRepository implements MerchantRepository {
  readonly #byId = new Map<string, Merchant>();

  async insert(merchant: Merchant): Promise<Merchant> {
    if (this.#byId.has(merchant.id)) {
      throw new ConflictError(`Merchant ${merchant.id} already exists`, { id: merchant.id });
    }
    this.#byId.set(merchant.id, merchant);
    return merchant;
  }

  async findById(id: string): Promise<Merchant | null> {
    return this.#byId.get(id) ?? null;
  }

  async list(): Promise<readonly Merchant[]> {
    return [...this.#byId.values()];
  }

  async update(merchant: Merchant, expectedVersion: number): Promise<void> {
    const current = this.#byId.get(merchant.id);
    if (current === undefined) {
      throw new ConflictError(`Merchant ${merchant.id} does not exist`, { id: merchant.id });
    }
    if (current.version !== expectedVersion) {
      throw new ConcurrencyError(`Merchant ${merchant.id} was modified concurrently`, {
        id: merchant.id,
        expectedVersion,
        actualVersion: current.version,
      });
    }
    this.#byId.set(merchant.id, merchant);
  }

  /** Rollback support for `InMemoryMerchantAccountRepository`. Not a port method. */
  remove(id: string): void {
    this.#byId.delete(id);
  }
}

/**
 * Both writes or neither, over the two in-memory repositories.
 *
 * Takes the same repositories the rest of a test uses, so a merchant created
 * here is visible to `findById` and a failed creation leaves nothing findable —
 * which is the property under test. Rolls back by removing what it added rather
 * than by copying the maps: the merchant is new by construction, so discarding
 * it cannot discard anything that was already there.
 */
export class InMemoryMerchantAccountRepository implements MerchantAccountRepository {
  readonly #merchants: InMemoryMerchantRepository;
  readonly #users: InMemoryUserRepository;

  constructor(merchants: InMemoryMerchantRepository, users: InMemoryUserRepository) {
    this.#merchants = merchants;
    this.#users = users;
  }

  async insertWithFirstUser(merchant: Merchant, user: User): Promise<void> {
    await this.#merchants.insert(merchant);
    try {
      await this.#users.insert(user);
    } catch (error) {
      this.#merchants.remove(merchant.id);
      throw error;
    }
  }
}

export class InMemorySessionRepository implements SessionRepository {
  readonly #byId = new Map<string, Session>();

  async insert(session: Session): Promise<Session> {
    if (this.#byId.has(session.id)) {
      throw new ConflictError(`Session ${session.id} already exists`, { id: session.id });
    }
    this.#byId.set(session.id, session);
    return session;
  }

  async findById(id: string): Promise<Session | null> {
    return this.#byId.get(id) ?? null;
  }

  async revoke(id: string, revokedAt: Date): Promise<void> {
    const session = this.#byId.get(id);
    if (session === undefined) return;
    this.#byId.set(id, { ...session, revokedAt });
  }

  async deleteExpired(now: Date): Promise<number> {
    const expired: string[] = [];
    for (const [id, session] of this.#byId) {
      if (session.expiresAt < now) expired.push(id);
    }
    for (const id of expired) this.#byId.delete(id);
    return expired.length;
  }
}

/**
 * Append-only in-memory settings audit.
 *
 * Deliberately offers no way to remove or rewrite an entry: the Postgres table
 * has no update or delete path either, and a fake that allowed one would let a
 * test pass that the real adapter could not.
 */
export class InMemoryMerchantSettingChangeRepository implements MerchantSettingChangeRepository {
  readonly #changes: MerchantSettingChange[] = [];

  async append(changes: readonly MerchantSettingChange[]): Promise<void> {
    this.#changes.push(...changes);
  }

  async list(merchantId: string, limit = 100): Promise<readonly MerchantSettingChange[]> {
    return this.#changes
      .filter((change) => change.merchantId === merchantId)
      .sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime())
      .slice(0, limit);
  }
}

export class InMemoryApiKeyRepository implements ApiKeyRepository {
  readonly #byId = new Map<string, ApiKey>();
  readonly #bySecretHash = new Map<string, string>();

  async insert(key: ApiKey): Promise<void> {
    if (this.#byId.has(key.id)) {
      throw new ConflictError(`API key ${key.id} already exists`, { id: key.id });
    }
    this.#byId.set(key.id, key);
    this.#bySecretHash.set(key.secretHash, key.id);
  }

  async findById(id: string): Promise<ApiKey | null> {
    return this.#byId.get(id) ?? null;
  }

  async findBySecretHash(secretHash: string): Promise<ApiKey | null> {
    const id = this.#bySecretHash.get(secretHash);
    return id === undefined ? null : (this.#byId.get(id) ?? null);
  }

  async listByMerchant(merchantId: string): Promise<readonly ApiKey[]> {
    return [...this.#byId.values()]
      .filter((key) => key.merchantId === merchantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async updateLastUsed(id: string, lastUsedAt: Date): Promise<void> {
    const key = this.#byId.get(id);
    if (key === undefined) return;
    this.#byId.set(id, { ...key, lastUsedAt });
  }

  async update(key: ApiKey, expectedVersion: number): Promise<void> {
    const current = this.#byId.get(key.id);
    if (current === undefined) {
      throw new ConflictError(`API key ${key.id} does not exist`, { id: key.id });
    }
    if (current.version !== expectedVersion) {
      throw new ConcurrencyError(`API key ${key.id} was modified concurrently`, {
        id: key.id,
        expectedVersion,
        actualVersion: current.version,
      });
    }
    this.#byId.set(key.id, key);
  }
}

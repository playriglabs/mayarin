/**
 * Reference in-memory fakes for the auth ports, shipped in a segregated
 * `/testing` subpath so domain `src/` stays pure.
 *
 * Mirror the Postgres invariants — unique email, unique session id — so tests
 * exercise the same failure modes without a database. Expiry is not enforced
 * here: the session service checks `expiresAt` against the clock, so a repo
 * returns the row and the service decides whether it is still live.
 */

import { ConflictError } from "@mayarin/shared";
import type {
  Merchant,
  MerchantRepository,
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

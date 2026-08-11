/**
 * Auth repository ports.
 *
 * Implementations live outside core (`packages/db`), which is what keeps the
 * auth domain testable and swappable without a database.
 */

import type { ApiKey } from "./api-key.ts";
import type {
  Merchant,
  MerchantRepository,
  MerchantSettingChange,
  MerchantSettingChangeRepository,
} from "./merchant.ts";
import type { Session, User } from "./types.ts";

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  insert(user: User): Promise<User>;
  listByMerchant(merchantId: string): Promise<readonly User[]>;
  touchUpdatedAt(id: string, updatedAt: Date): Promise<void>;
}

export interface SessionRepository {
  insert(session: Session): Promise<Session>;
  findById(id: string): Promise<Session | null>;
  revoke(id: string, revokedAt: Date): Promise<void>;
  deleteExpired(now: Date): Promise<number>;
}

export interface ApiKeyRepository {
  insert(key: ApiKey): Promise<void>;
  findById(id: string): Promise<ApiKey | null>;
  /** Looked up on a bearer request, by the hash of the presented secret. */
  findBySecretHash(secretHash: string): Promise<ApiKey | null>;
  listByMerchant(merchantId: string): Promise<readonly ApiKey[]>;
  /** Records the last time a bearer request used this key. */
  updateLastUsed(id: string, lastUsedAt: Date): Promise<void>;
  /** Persists a deactivation; the version is the optimistic-locking token. */
  update(key: ApiKey, expectedVersion: number): Promise<void>;
}

export type {
  Merchant,
  MerchantRepository,
  MerchantSettingChange,
  MerchantSettingChangeRepository,
};

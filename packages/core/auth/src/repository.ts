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
import type { EmailVerification, Session, User } from "./types.ts";

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  insert(user: User): Promise<User>;
  listByMerchant(merchantId: string): Promise<readonly User[]>;
  touchUpdatedAt(id: string, updatedAt: Date): Promise<void>;
  /** Records that this account proved control of its email. Idempotent. */
  markEmailVerified(id: string, verifiedAt: Date): Promise<void>;
}

export interface EmailVerificationRepository {
  insert(verification: EmailVerification): Promise<void>;
  /**
   * The newest code issued to this account that is still redeemable — neither
   * consumed nor expired. An account can only ever be verifying against one, so
   * issuing a new code supersedes the last rather than adding to it.
   */
  findLiveByUser(userId: string, now: Date): Promise<EmailVerification | null>;
  /** Counts a failed guess against the cap. */
  recordAttempt(id: string, attempts: number): Promise<void>;
  markConsumed(id: string, consumedAt: Date): Promise<void>;
  /** Invalidates every outstanding code for this account, before a new one is issued. */
  consumeAllForUser(userId: string, consumedAt: Date): Promise<void>;
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

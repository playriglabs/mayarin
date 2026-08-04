/**
 * Auth repository ports.
 *
 * Implementations live outside core (`packages/db`), which is what keeps the
 * auth domain testable and swappable without a database.
 */

import type { Merchant, MerchantRepository } from "./merchant.ts";
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

export type { Merchant, MerchantRepository };

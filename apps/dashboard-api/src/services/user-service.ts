/**
 * User application service.
 *
 * Account creation is backend-only tooling: the CLI (`seed:merchant`) creates a
 * merchant + its first account via `createMerchantAccount`; a merchant-admin
 * grants sub-accounts in the same merchant via `createMerchantUser` (the
 * `POST /admin/users` route, gated on `users:manage`). Plain async, not
 * `Effect` — account creation is off the hot path, so the typed-error
 * discipline that buys us something in `SessionService`/`AuthService` would be
 * ceremony here. Passwords are hashed through the injected `PasswordHasher`.
 */

import { randomBytes } from "node:crypto";
import type {
  Merchant,
  MerchantRepository,
  PasswordHasher,
  Permission,
  User,
  UserRepository,
} from "@mayarin/auth";
import { type AssetCode, type Clock, generateId } from "@mayarin/shared";

export interface UserServiceOptions {
  readonly users: UserRepository;
  readonly merchants: MerchantRepository;
  readonly hasher: PasswordHasher;
  readonly clock: Clock;
}

export interface CreateAccountResult {
  readonly user: User;
  /** True when a password was generated rather than supplied. */
  readonly generated: boolean;
  /** The plaintext password, surfaced only when generated so it can be printed once. */
  readonly password?: string;
}

export interface CreateMerchantAccountInput {
  readonly email: string;
  readonly password?: string;
  readonly merchantName: string;
  /** The one asset this merchant is paid in. */
  readonly settlementAsset: AssetCode;
  /** Assets a payer may pay them with; empty defers to the deployment default. */
  readonly acceptedAssets: readonly AssetCode[];
  /** Where they are paid on-chain. Absent for an off-chain-only merchant. */
  readonly settlementAddress?: string;
  readonly permissions: readonly Permission[];
}

export interface CreateMerchantUserInput {
  readonly actorMerchantId: string;
  readonly email: string;
  readonly password?: string;
  readonly permissions: readonly Permission[];
}

export class UserService {
  readonly #users: UserRepository;
  readonly #merchants: MerchantRepository;
  readonly #hasher: PasswordHasher;
  readonly #clock: Clock;

  constructor(options: UserServiceOptions) {
    this.#users = options.users;
    this.#merchants = options.merchants;
    this.#hasher = options.hasher;
    this.#clock = options.clock;
  }

  /**
   * Creates a new merchant tenant + its first account. Used by the
   * `seed:merchant` CLI. A strong random password is generated when none is
   * supplied and returned so the CLI can print it once.
   */
  async createMerchantAccount(input: CreateMerchantAccountInput): Promise<CreateAccountResult> {
    const now = this.#clock.now();
    const merchant: Merchant = {
      id: generateId("mrc", now.getTime()),
      name: input.merchantName,
      settlementAsset: input.settlementAsset,
      acceptedAssets: input.acceptedAssets,
      ...(input.settlementAddress === undefined
        ? {}
        : { settlementAddress: input.settlementAddress }),
      createdAt: now,
      updatedAt: now,
    };
    await this.#merchants.insert(merchant);

    const { user, generated, password } = await this.createUser(
      merchant.id,
      input.email,
      input.password,
      input.permissions,
      now,
    );
    return { user, generated, ...(password === undefined ? {} : { password }) };
  }

  /** Lists the accounts in one merchant (the dashboard admin surface). */
  async listMerchantUsers(merchantId: string): Promise<readonly User[]> {
    return this.#users.listByMerchant(merchantId);
  }

  /**
   * Creates a sub-account in the caller's own merchant. The new account's
   * `merchantId` is always `actorMerchantId` — a merchant-admin can only grant
   * access within its own tenant, never cross-merchant.
   */
  async createMerchantUser(input: CreateMerchantUserInput): Promise<CreateAccountResult> {
    const now = this.#clock.now();
    const { user, generated, password } = await this.createUser(
      input.actorMerchantId,
      input.email,
      input.password,
      input.permissions,
      now,
    );
    return { user, generated, ...(password === undefined ? {} : { password }) };
  }

  async createUser(
    merchantId: string,
    email: string,
    password: string | undefined,
    permissions: readonly Permission[],
    now: Date,
  ): Promise<CreateAccountResult> {
    const generated = password === undefined;
    const plaintext = generated ? randomBytes(18).toString("base64url") : password;
    const user: User = {
      id: generateId("usr", now.getTime()),
      email,
      passwordHash: await this.#hasher.hash(plaintext ?? ""),
      merchantId,
      permissions: [...permissions],
      createdAt: now,
      updatedAt: now,
    };
    await this.#users.insert(user);
    return generated ? { user, generated: true, password: plaintext } : { user, generated: false };
  }
}

/**
 * Merchant API key service.
 *
 * The surface behind `/api-keys`: a merchant mints bearer tokens that grant a
 * subset of their own permissions, for a POS or an integration that cannot hold
 * a session cookie. The secret is returned exactly once at creation and never
 * again — only its sha-256 hash is stored, which is what a bearer request is
 * looked up by.
 *
 * Every method takes the caller's `Scope` and reads `scope.merchantId` from it.
 * A key belonging to another merchant resolves to the same `NotFoundError` an
 * absent id would, so a foreign id is not a leak.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  type ApiKey,
  type ApiKeyRepository,
  createApiKey,
  deactivateApiKey,
  type Permission,
} from "@mayarin/auth";
import { type Clock, NotFoundError } from "@mayarin/shared";
import type { Scope } from "../dto/auth.ts";

/** Generates a fresh plaintext secret. Injected so a test can fix the value. */
export type SecretGenerator = () => string;
/** Hashes a secret for storage and lookup. Injected so a test can use a plain hash. */
export type SecretHasher = (secret: string) => string;

export const systemSecretGenerator: SecretGenerator = () => `pk_${randomBytes(32).toString("hex")}`;

export const systemSecretHasher: SecretHasher = (secret) =>
  createHash("sha256").update(secret).digest("hex");

export interface ApiKeyServiceOptions {
  readonly keys: ApiKeyRepository;
  readonly clock: Clock;
  readonly secretGenerator?: SecretGenerator;
  readonly secretHasher?: SecretHasher;
}

export interface ApiKeyListFilter {
  readonly q?: string;
  readonly status?: "active" | "inactive";
  readonly sort?: "created" | "-created";
  readonly from?: Date;
  readonly to?: Date;
}

export interface CreateApiKeyInput {
  readonly name: string;
  readonly permissions: readonly Permission[];
}

/** A created key with the plaintext secret shown this one time only. */
export interface ApiKeyCreateResult {
  readonly key: ApiKey;
  readonly secret: string;
}

export class ApiKeyService {
  readonly #keys: ApiKeyRepository;
  readonly #clock: Clock;
  readonly #generate: SecretGenerator;
  readonly #hash: SecretHasher;

  constructor(options: ApiKeyServiceOptions) {
    this.#keys = options.keys;
    this.#clock = options.clock;
    this.#generate = options.secretGenerator ?? systemSecretGenerator;
    this.#hash = options.secretHasher ?? systemSecretHasher;
  }

  async list(scope: Scope, filter: ApiKeyListFilter = {}): Promise<readonly ApiKey[]> {
    const q = filter.q?.toLocaleLowerCase();
    const direction = filter.sort === "created" ? 1 : -1;
    return (await this.#keys.listByMerchant(scope.merchantId))
      .filter(
        (key) =>
          q === undefined ||
          key.id.toLocaleLowerCase().includes(q) ||
          key.name.toLocaleLowerCase().includes(q) ||
          key.prefix.toLocaleLowerCase().includes(q),
      )
      .filter((key) => filter.status === undefined || key.active === (filter.status === "active"))
      .filter((key) => filter.from === undefined || key.createdAt >= filter.from)
      .filter((key) => filter.to === undefined || key.createdAt < filter.to)
      .sort((a, b) => direction * (a.createdAt.getTime() - b.createdAt.getTime()));
  }

  /**
   * Mints a key. The secret is generated, hashed, and stored; the plaintext is
   * returned here and never recoverable — not by the merchant, not by Mayarin.
   * `prefix` is the first characters of the plaintext, so a listing can tell two
   * keys apart without the secret.
   */
  async create(scope: Scope, input: CreateApiKeyInput): Promise<ApiKeyCreateResult> {
    const secret = this.#generate();
    const key = createApiKey({
      merchantId: scope.merchantId,
      name: input.name,
      secretHash: this.#hash(secret),
      prefix: secret.slice(0, 12),
      permissions: input.permissions,
      now: this.#clock.now(),
    });
    await this.#keys.insert(key);
    return { key, secret };
  }

  async deactivate(scope: Scope, id: string): Promise<ApiKey> {
    const key = await this.#ownKey(scope, id);
    const deactivated = deactivateApiKey(key, this.#clock.now());
    await this.#keys.update(deactivated, key.version);
    return deactivated;
  }

  /**
   * Verifies a bearer secret. Returns the scope the key grants, or `null` for a
   * secret no active key matches — the middleware turns the latter into a 401,
   * the same response an absent token gets, so a revoked key does not reveal
   * that it once existed.
   */
  async verifySecret(secret: string): Promise<Scope | null> {
    const key = await this.#keys.findBySecretHash(this.#hash(secret));
    if (key === null || !key.active) return null;
    await this.#keys.updateLastUsed(key.id, this.#clock.now());
    return { merchantId: key.merchantId, permissions: new Set(key.permissions) };
  }

  async #ownKey(scope: Scope, id: string): Promise<ApiKey> {
    const key = await this.#keys.findById(id);
    if (key === null || key.merchantId !== scope.merchantId) {
      throw new NotFoundError(`API key ${id} not found`, { id });
    }
    return key;
  }
}

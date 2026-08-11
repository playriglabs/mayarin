/**
 * API key creation and deactivation.
 *
 * Pure functions over immutable values, mirroring `customer.ts` / `product.ts`:
 * a deactivation returns a new key with a bumped `version`, which is the
 * optimistic-locking token the repository takes. The secret itself never lives
 * here — only its hash and a short prefix a listing can show so a merchant can
 * tell two keys apart without the secret.
 */

import { generateId, ValidationError } from "@mayarin/shared";
import type { Permission } from "./permission.ts";
import { isPermission } from "./permission.ts";

export interface ApiKey {
  readonly id: string;
  readonly merchantId: string;
  /** A merchant-chosen label, e.g. "POS register 3". */
  readonly name: string;
  /** sha-256 of the full plaintext secret. Looked up by it on a bearer request. */
  readonly secretHash: string;
  /** First characters of the plaintext, shown in listings to identify a key. */
  readonly prefix: string;
  /** Subset of the merchant's permissions this key grants. */
  readonly permissions: readonly Permission[];
  /** Present once a bearer request has used this key. */
  readonly lastUsedAt?: Date;
  readonly active: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

export interface CreateApiKeyInput {
  readonly merchantId: string;
  readonly name: string;
  readonly secretHash: string;
  readonly prefix: string;
  readonly permissions: readonly Permission[];
  readonly now: Date;
}

export function createApiKey(input: CreateApiKeyInput): ApiKey {
  if (input.name.trim() === "") {
    throw new ValidationError("An API key must have a name", {});
  }
  if (input.secretHash === "") {
    throw new ValidationError("An API key must carry a secret hash", {});
  }
  if (input.prefix === "") {
    throw new ValidationError("An API key must carry a prefix", {});
  }
  for (const permission of input.permissions) {
    if (!isPermission(permission)) {
      throw new ValidationError(`Unknown permission "${String(permission)}"`, { permission });
    }
  }
  if (input.permissions.length === 0) {
    throw new ValidationError("An API key must grant at least one permission", {});
  }

  const createdAt = new Date(input.now);
  return {
    id: generateId("mak", createdAt.getTime()),
    merchantId: input.merchantId,
    name: input.name.trim(),
    secretHash: input.secretHash,
    prefix: input.prefix,
    permissions: [...input.permissions],
    active: true,
    createdAt,
    updatedAt: createdAt,
    version: 1,
  };
}

/** Marks a key inactive. A minted secret cannot be "unmintoned", so no reactivation. */
export function deactivateApiKey(key: ApiKey, now: Date): ApiKey {
  if (!key.active) {
    throw new ValidationError(`API key ${key.id} is already inactive`, { id: key.id });
  }
  return { ...key, active: false, updatedAt: new Date(now), version: key.version + 1 };
}

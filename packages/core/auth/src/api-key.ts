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

/**
 * What a key is safe to be seen by (#113).
 *
 * A `secret` key (`sk_...`) is the merchant surface: it lives on a server and
 * grants a subset of the merchant's permissions. A `publishable` key
 * (`pk_...`) ships in a browser bundle by design: it identifies the merchant
 * and grants a fixed public surface — catalog read and cart checkout — and
 * nothing from the permission set, ever.
 */
export type ApiKeyKind = "secret" | "publishable";

export const API_KEY_KINDS: readonly ApiKeyKind[] = ["secret", "publishable"];

export function isApiKeyKind(value: unknown): value is ApiKeyKind {
  return API_KEY_KINDS.includes(value as ApiKeyKind);
}

export interface ApiKey {
  readonly id: string;
  readonly merchantId: string;
  readonly kind: ApiKeyKind;
  /** A merchant-chosen label, e.g. "POS register 3". */
  readonly name: string;
  /** sha-256 of the full plaintext secret. Looked up by it on a bearer request. */
  readonly secretHash: string;
  /** First characters of the plaintext, shown in listings to identify a key. */
  readonly prefix: string;
  /**
   * Subset of the merchant's permissions this key grants. Always empty on a
   * publishable key — its grant is fixed by `kind`, not configured.
   */
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
  /** Defaults to `secret`, the kind every key was before publishable existed. */
  readonly kind?: ApiKeyKind;
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

  const kind = input.kind ?? "secret";
  if (kind === "secret" && input.permissions.length === 0) {
    throw new ValidationError("A secret API key must grant at least one permission", {});
  }
  // Fixed by kind, never configured: a publishable key that carried
  // `catalog:manage` would put a write grant in every browser bundle.
  if (kind === "publishable" && input.permissions.length > 0) {
    throw new ValidationError("A publishable API key cannot carry permissions", {
      permissions: input.permissions,
    });
  }

  const createdAt = new Date(input.now);
  return {
    id: generateId("mak", createdAt.getTime()),
    merchantId: input.merchantId,
    kind,
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

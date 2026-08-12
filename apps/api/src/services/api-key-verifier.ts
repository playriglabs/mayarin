/**
 * Bearer-secret verification (#14).
 *
 * Mirrors the dashboard's lookup exactly: sha-256 the presented secret, find
 * the key by hash, refuse an inactive one. The hash function lives here rather
 * than in `@mayarin/auth` because the domain stores only hashes — what a
 * plaintext secret looks like is a transport concern.
 */

import { createHash } from "node:crypto";
import type { ApiKeyRepository } from "@mayarin/auth";
import type { Clock } from "@mayarin/shared";
import type { ApiKeyVerifier } from "../middleware/api-key.ts";

export function createApiKeyVerifier(deps: {
  readonly keys: ApiKeyRepository;
  readonly clock: Clock;
}): ApiKeyVerifier {
  return async (secret) => {
    const hash = createHash("sha256").update(secret).digest("hex");
    const key = await deps.keys.findBySecretHash(hash);
    if (key === null || !key.active) return null;
    await deps.keys.updateLastUsed(key.id, deps.clock.now());
    return { merchantId: key.merchantId, kind: key.kind, permissions: new Set(key.permissions) };
  };
}

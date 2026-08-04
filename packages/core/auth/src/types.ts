/**
 * Auth domain types.
 *
 * Pure data only — no I/O, no clock. Every user is a merchant account
 * (`merchantId` is required) carrying a `permissions` flag set; `revokedAt` is
 * present once a session has been revoked. Optionals follow the codebase
 * `T | undefined` convention (never `| null` in domain).
 */

import type { Permission } from "./permission.ts";

export interface User {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  /** The merchant tenant this account belongs to; also the payments scope key. */
  readonly merchantId: string;
  /** Permissions gating surfaces within this merchant. */
  readonly permissions: readonly Permission[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface Session {
  readonly id: string;
  readonly userId: string;
  /** Double-submit CSRF token echoed back on mutating requests. */
  readonly csrfToken: string;
  readonly expiresAt: Date;
  /** Present once the session has been revoked. */
  readonly revokedAt?: Date;
  readonly createdAt: Date;
}

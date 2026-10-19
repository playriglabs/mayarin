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
  /**
   * When this account proved it controls its email address, if it ever has.
   *
   * Absent means the account exists but cannot sign in: self-registration
   * creates the merchant and the account up front, and the code sent to the
   * address is what turns it into a usable login. An account created by an
   * operator or by a merchant-admin is verified on creation — somebody with
   * access already vouched for the address.
   */
  readonly emailVerifiedAt?: Date;
  /** Authenticator-app second factor (SEC-15, SEC-16). Absent until setup starts. */
  readonly mfa?: MfaState;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * An account's TOTP state. `enabledAt` is what makes it a second factor: a
 * secret without it is a setup the account has not yet proved it can read.
 */
export interface MfaState {
  /** The base32 secret, encrypted by the application before it reaches storage. */
  readonly secret: string;
  readonly enabledAt?: Date;
  /** The last time step accepted, so one code cannot be used twice. */
  readonly lastStep?: number;
  /** SHA-256 of each unused recovery code. */
  readonly recoveryHashes: readonly string[];
}

/**
 * A one-time code proving control of an email address.
 *
 * The code itself is never stored — only its hash, the same way a password is —
 * so a leaked table cannot be replayed into an account. Three bounds make the
 * online guess unprofitable: a short expiry, a cap on attempts, and the code
 * being single-use once consumed.
 */
export interface EmailVerification {
  readonly id: string;
  readonly userId: string;
  /** Argon2id over the plaintext code. */
  readonly codeHash: string;
  readonly expiresAt: Date;
  /** Present once the code has been redeemed; a redeemed code never verifies again. */
  readonly consumedAt?: Date;
  /** Failed attempts against this code so far. */
  readonly attempts: number;
  readonly createdAt: Date;
}

/** One successful sign-in, kept after its session is gone. */
export interface LoginEvent {
  readonly id: string;
  readonly userId: string;
  /** What the deployment's trusted header or socket said; `"unknown"` if neither did. */
  readonly ip: string;
  readonly userAgent: string;
  readonly createdAt: Date;
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
  /** Last request this session served, to within the touch interval; idle expiry reads it. */
  readonly lastSeenAt: Date;
}

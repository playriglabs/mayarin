/**
 * Self-service registration and email verification.
 *
 * A merchant signs up with three things — who they are, an email, a password —
 * and nothing about a chain. The settlement address is deliberately not asked
 * for here: it decides where their money lands, the domain already holds it as
 * optional, and Settings is where it belongs once they are inside and can read
 * what they are pasting.
 *
 * ## Why the account exists before the code is redeemed
 *
 * Registration writes the merchant and the account immediately, with
 * `emailVerifiedAt` absent, and the code is what makes the account usable.
 * The alternative — holding the signup in a pending table until the code lands
 * — needs a second shape of "almost a user" and a reconciliation job, and buys
 * nothing: an unverified account cannot sign in, cannot be paid into, and holds
 * no permission that matters.
 *
 * ## What is deliberately not said out loud
 *
 * `register` and `resend` answer the same way whether or not the email is
 * already taken. Registration is an unauthenticated endpoint, so an answer that
 * distinguished the two would be a free membership oracle for any address
 * somebody cares to try. The person who actually owns the address learns the
 * truth by email; nobody learns it from the response.
 */

import { randomInt } from "node:crypto";
import type {
  EmailVerification,
  EmailVerificationRepository,
  Merchant,
  MerchantAccountRepository,
  PasswordHasher,
  Permission,
  User,
  UserRepository,
} from "@mayarin/auth";
import {
  type AssetCode,
  type Clock,
  generateId,
  UnauthorizedError,
  ValidationError,
} from "@mayarin/shared";
import type { VerificationEmailSender } from "./verification-email-service.ts";

/** Six digits: short enough to retype from a phone, and never the leading-zero-eating number. */
const CODE_LENGTH = 6;

/**
 * How long a code lives.
 *
 * Long enough to survive a slow inbox, short enough that a code read over
 * somebody's shoulder is worthless by the time it is used.
 */
const CODE_TTL_MINUTES = 15;

/**
 * Wrong guesses a single code tolerates before it is burned.
 *
 * Five against a six-digit space is one in two hundred thousand per code. The
 * cap is what keeps that true: without it, the endpoint's own rate limit is the
 * only bound and a patient attacker gets a million tries.
 */
const MAX_ATTEMPTS = 5;

/**
 * What a new merchant is allowed to do.
 *
 * The full set: they are the only account in a tenant they just created, so
 * anything less would lock them out of their own dashboard — including the
 * Settings surface where the settlement address is pasted.
 */
const FOUNDER_PERMISSIONS: readonly Permission[] = [
  "payments:read",
  "settings:manage",
  "users:manage",
  "catalog:manage",
  "admin:access",
];

export interface RegistrationServiceOptions {
  readonly users: UserRepository;
  readonly accounts: MerchantAccountRepository;
  readonly verifications: EmailVerificationRepository;
  readonly hasher: PasswordHasher;
  readonly emails: VerificationEmailSender;
  readonly clock: Clock;
  /** What a merchant who has chosen nothing is paid in; the deployment default. */
  readonly settlementAsset: AssetCode;
}

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly merchantName: string;
}

export interface VerifyEmailInput {
  readonly email: string;
  readonly code: string;
}

export class RegistrationService {
  readonly #users: UserRepository;
  readonly #accounts: MerchantAccountRepository;
  readonly #verifications: EmailVerificationRepository;
  readonly #hasher: PasswordHasher;
  readonly #emails: VerificationEmailSender;
  readonly #clock: Clock;
  readonly #settlementAsset: AssetCode;

  constructor(options: RegistrationServiceOptions) {
    this.#users = options.users;
    this.#accounts = options.accounts;
    this.#verifications = options.verifications;
    this.#hasher = options.hasher;
    this.#emails = options.emails;
    this.#clock = options.clock;
    this.#settlementAsset = options.settlementAsset;
  }

  /**
   * Creates the merchant and its first account, then emails a code.
   *
   * Returns nothing either way. An email already registered is answered
   * identically to a fresh one, and the existing owner gets a code they can use
   * — which is also the recovery path when somebody abandons a signup halfway.
   */
  async register(input: RegisterInput): Promise<void> {
    const existing = await this.#users.findByEmail(input.email);
    if (existing !== null) {
      // Already verified: nothing to send, and saying so would answer the
      // question this endpoint refuses to answer.
      if (existing.emailVerifiedAt !== undefined) return;
      await this.#issueCode(existing);
      return;
    }

    const now = this.#clock.now();
    const merchant: Merchant = {
      id: generateId("mrc", now.getTime()),
      name: input.merchantName,
      settlementAsset: this.#settlementAsset,
      // Empty defers to the deployment default, which is what a merchant who
      // has never opened the asset matrix should accept.
      acceptedAssets: [],
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const user: User = {
      id: generateId("usr", now.getTime()),
      email: input.email,
      passwordHash: await this.#hasher.hash(input.password),
      merchantId: merchant.id,
      permissions: [...FOUNDER_PERMISSIONS],
      createdAt: now,
      updatedAt: now,
    };
    // One unit of work: a merchant with no account is unreachable and nothing
    // deletes it.
    await this.#accounts.insertWithFirstUser(merchant, user);
    await this.#issueCode(user);
  }

  /** Re-issues a code, invalidating any still outstanding. Silent about unknown addresses. */
  async resend(email: string): Promise<void> {
    const user = await this.#users.findByEmail(email);
    if (user === null || user.emailVerifiedAt !== undefined) return;
    await this.#issueCode(user);
  }

  /**
   * Redeems a code and marks the account verified.
   *
   * Every failure — unknown address, no live code, wrong digits, too many
   * guesses — raises the same `ValidationError`. The reader who holds the code
   * is never in doubt about which one they typed; anybody else learns nothing
   * about which half of the pair was wrong.
   */
  async verify(input: VerifyEmailInput): Promise<void> {
    const invalid = new ValidationError("That code is not valid. Ask for a new one.");
    const user = await this.#users.findByEmail(input.email);
    if (user === null) throw invalid;
    // An already-verified account is a no-op rather than an error: a double
    // submit of the same form should not read as a failure.
    if (user.emailVerifiedAt !== undefined) return;

    const now = this.#clock.now();
    const verification = await this.#verifications.findLiveByUser(user.id, now);
    if (verification === null) throw invalid;
    if (verification.attempts >= MAX_ATTEMPTS) {
      await this.#verifications.markConsumed(verification.id, now);
      throw invalid;
    }

    const matches = await this.#hasher.verify(input.code, verification.codeHash);
    if (!matches) {
      await this.#verifications.recordAttempt(verification.id, verification.attempts + 1);
      throw invalid;
    }

    await this.#verifications.markConsumed(verification.id, now);
    await this.#users.markEmailVerified(user.id, now);
  }

  async #issueCode(user: User): Promise<void> {
    const now = this.#clock.now();
    const code = generateCode();
    // The old code dies before the new one is written: two live codes would
    // double the guessing surface for the same account.
    await this.#verifications.consumeAllForUser(user.id, now);
    const verification: EmailVerification = {
      id: generateId("evf", now.getTime()),
      userId: user.id,
      codeHash: await this.#hasher.hash(code),
      expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000),
      attempts: 0,
      createdAt: now,
    };
    await this.#verifications.insert(verification);
    await this.#emails.sendVerification({
      email: user.email,
      code,
      expiresInMinutes: CODE_TTL_MINUTES,
    });
  }
}

/** The error a sign-in gets when the address was never confirmed. */
export const EMAIL_NOT_VERIFIED = new UnauthorizedError(
  "Confirm your email address before signing in. Check your inbox for the code.",
  { reason: "email_not_verified" },
);

/**
 * A uniformly random six-digit code, leading zeros included.
 *
 * `randomInt` rather than `Math.random`: this is a credential, and a predictable
 * one is a login for whoever can predict it.
 */
function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

export { CODE_TTL_MINUTES, MAX_ATTEMPTS };

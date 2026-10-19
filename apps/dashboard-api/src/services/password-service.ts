/**
 * Password change and reset (SEC-15).
 *
 * Both end the same way: the hash is replaced and every session that could
 * belong to somebody who knew the old password is revoked. Change keeps the
 * caller's own session; reset, having no session to keep, revokes all.
 *
 * A reset code is the same kind of code as an email-verification code and lives
 * in the same table: six digits, hashed, expiring, capped attempts. Redeeming
 * one proves control of the address, which is also what verification proves, so
 * the two do not need separate storage. An account with a second factor must
 * present it to reset: the mailbox alone never opens the account.
 */

import { randomInt } from "node:crypto";
import type {
  EmailVerification,
  EmailVerificationRepository,
  PasswordHasher,
  User,
  UserRepository,
} from "@mayarin/auth";
import { type Clock, generateId, UnauthorizedError, ValidationError } from "@mayarin/shared";
import type { MfaService } from "./mfa-service.ts";
import { MFA_CODE_REQUIRED } from "./mfa-service.ts";
import type { VerificationEmailSender } from "./verification-email-service.ts";

const CODE_LENGTH = 6;
const CODE_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;

export interface PasswordServiceOptions {
  readonly users: UserRepository;
  readonly verifications: EmailVerificationRepository;
  readonly hasher: PasswordHasher;
  readonly emails: VerificationEmailSender;
  readonly mfa: MfaService;
  readonly clock: Clock;
}

export class PasswordService {
  readonly #users: UserRepository;
  readonly #verifications: EmailVerificationRepository;
  readonly #hasher: PasswordHasher;
  readonly #emails: VerificationEmailSender;
  readonly #mfa: MfaService;
  readonly #clock: Clock;

  constructor(options: PasswordServiceOptions) {
    this.#users = options.users;
    this.#verifications = options.verifications;
    this.#hasher = options.hasher;
    this.#emails = options.emails;
    this.#mfa = options.mfa;
    this.#clock = options.clock;
  }

  /** For a signed-in person: the current password, and the second factor if they have one. */
  async change(
    user: User,
    input: { currentPassword: string; newPassword: string; code?: string },
  ): Promise<void> {
    if (!(await this.#hasher.verify(input.currentPassword, user.passwordHash))) {
      throw new UnauthorizedError("Current password is wrong");
    }
    if (this.#mfa.isEnabled(user)) {
      if (input.code === undefined) throw MFA_CODE_REQUIRED;
      await this.#mfa.verifyCode(user, input.code);
    }
    await this.#users.updatePassword(
      user.id,
      await this.#hasher.hash(input.newPassword),
      this.#clock.now(),
    );
  }

  /**
   * Emails a reset code. Silent for an unknown or unconfirmed address, so the
   * response is no membership oracle.
   */
  async requestReset(email: string): Promise<void> {
    const user = await this.#users.findByEmail(email);
    if (user === null || user.emailVerifiedAt === undefined) return;

    const now = this.#clock.now();
    const code = String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
    // The old code dies first: two live codes double the guessing surface.
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
    await this.#emails.sendPasswordReset({
      email: user.email,
      code,
      expiresInMinutes: CODE_TTL_MINUTES,
    });
  }

  /**
   * Redeems a reset code and sets the new password. Every failure on the code
   * raises the same error; a wrong second-factor code burns an attempt too, so
   * the mailbox cannot be used to guess it.
   */
  async reset(input: {
    email: string;
    code: string;
    newPassword: string;
    mfaCode?: string;
  }): Promise<User> {
    const invalid = new ValidationError("That code is not valid. Ask for a new one.");
    const user = await this.#users.findByEmail(input.email);
    if (user === null || user.emailVerifiedAt === undefined) throw invalid;

    const now = this.#clock.now();
    const verification = await this.#verifications.findLiveByUser(user.id, now);
    if (verification === null) throw invalid;
    if (verification.attempts >= MAX_ATTEMPTS) {
      await this.#verifications.markConsumed(verification.id, now);
      throw invalid;
    }
    if (!(await this.#hasher.verify(input.code, verification.codeHash))) {
      await this.#verifications.recordAttempt(verification.id, verification.attempts + 1);
      throw invalid;
    }

    if (this.#mfa.isEnabled(user)) {
      if (input.mfaCode === undefined) throw MFA_CODE_REQUIRED;
      try {
        await this.#mfa.verifyCode(user, input.mfaCode);
      } catch (error) {
        await this.#verifications.recordAttempt(verification.id, verification.attempts + 1);
        throw error;
      }
    }

    await this.#verifications.markConsumed(verification.id, now);
    await this.#users.updatePassword(user.id, await this.#hasher.hash(input.newPassword), now);
    return user;
  }
}

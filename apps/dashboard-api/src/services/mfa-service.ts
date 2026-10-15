/**
 * Authenticator-app second factor (SEC-15, SEC-16).
 *
 * Three jobs: enrol an account (a secret the account must prove it can read
 * before it counts), check a code at sign-in and before money moves, and hand
 * out the short-lived challenge that carries a sign-in between its password
 * step and its code step.
 *
 * The secret is encrypted with AES-256-GCM under a key derived from
 * configuration, so a database dump alone cannot generate codes. A code is good
 * once: the step it matched is stored and anything at or before it is refused.
 */

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import {
  hashRecoveryCode,
  type MfaState,
  matchTotp,
  newRecoveryCode,
  newTotpSecret,
  otpauthUri,
  type User,
  type UserRepository,
} from "@mayarin/auth";
import { type Clock, ConflictError, ForbiddenError, UnauthorizedError } from "@mayarin/shared";
import { toString as qrToString } from "qrcode";

const ISSUER = "Mayarin";
const RECOVERY_CODES = 10;
const CHALLENGE_TTL_MS = 5 * 60 * 1_000;

export interface MfaServiceOptions {
  readonly users: UserRepository;
  readonly clock: Clock;
  readonly encryptionKey: string;
}

export interface MfaEnrolment {
  /** The base32 key, for typing into an app that cannot scan. */
  readonly secret: string;
  readonly otpauthUri: string;
  /** An SVG of the QR, to be shown through an `<img>` and never injected as markup. */
  readonly qrSvg: string;
}

export const MFA_SETUP_REQUIRED = new ForbiddenError(
  "Set up two-factor authentication before moving funds or changing where they go.",
  { reason: "mfa_setup_required" },
);

export const MFA_CODE_REQUIRED = new ForbiddenError(
  "Enter the code from your authenticator app to continue.",
  { reason: "mfa_code_required" },
);

export const MFA_CODE_INVALID = new UnauthorizedError(
  "That code is not valid. Check the app and try again.",
  { reason: "mfa_code_invalid" },
);

export class MfaService {
  readonly #users: UserRepository;
  readonly #clock: Clock;
  readonly #key: Buffer;

  constructor(options: MfaServiceOptions) {
    this.#users = options.users;
    this.#clock = options.clock;
    this.#key = createHash("sha256").update(`mfa:${options.encryptionKey}`).digest();
  }

  findUser(id: string): Promise<User | null> {
    return this.#users.findById(id);
  }

  /** Whether the account has a proven second factor. */
  isEnabled(user: User): boolean {
    return user.mfa?.enabledAt !== undefined;
  }

  /** Starts (or restarts) enrolment. An enabled account must disable first. */
  async beginSetup(user: User): Promise<MfaEnrolment> {
    if (this.isEnabled(user)) {
      throw new ConflictError("Two-factor authentication is already enabled", {});
    }
    const secret = newTotpSecret();
    await this.#users.saveMfa(
      user.id,
      { secret: this.#encrypt(secret), recoveryHashes: [] },
      this.#clock.now(),
    );
    const uri = otpauthUri({ secret, account: user.email, issuer: ISSUER });
    return { secret, otpauthUri: uri, qrSvg: await qrToString(uri, { type: "svg", margin: 1 }) };
  }

  /** Proves the account can read the secret; returns the recovery codes, once. */
  async confirmSetup(user: User, code: string): Promise<readonly string[]> {
    const state = user.mfa;
    if (state === undefined || state.enabledAt !== undefined) {
      throw new ConflictError("There is no two-factor setup waiting to be confirmed", {});
    }
    const now = this.#clock.now();
    const step = matchTotp(this.#decrypt(state.secret), code, now);
    if (step === undefined) throw MFA_CODE_INVALID;

    const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
    await this.#users.saveMfa(
      user.id,
      {
        secret: state.secret,
        enabledAt: now,
        lastStep: step,
        recoveryHashes: codes.map(hashRecoveryCode),
      },
      now,
    );
    return codes;
  }

  /**
   * Accepts an authenticator code or, failing that, a recovery code, and spends
   * it. Throws when neither matches; there is no "wrong but fine" outcome.
   */
  async verifyCode(user: User, code: string): Promise<void> {
    const state = user.mfa;
    if (state === undefined || state.enabledAt === undefined) throw MFA_SETUP_REQUIRED;
    const now = this.#clock.now();

    const step = matchTotp(this.#decrypt(state.secret), code, now);
    if (step !== undefined) {
      if (state.lastStep !== undefined && step <= state.lastStep) throw MFA_CODE_INVALID;
      await this.#users.saveMfa(user.id, { ...state, lastStep: step }, now);
      return;
    }

    const hash = hashRecoveryCode(code);
    if (state.recoveryHashes.includes(hash)) {
      await this.#users.saveMfa(
        user.id,
        { ...state, recoveryHashes: state.recoveryHashes.filter((entry) => entry !== hash) },
        now,
      );
      return;
    }
    throw MFA_CODE_INVALID;
  }

  /** Removes the second factor, on a valid code. */
  async disable(user: User, code: string): Promise<void> {
    await this.verifyCode(user, code);
    await this.#users.saveMfa(user.id, null, this.#clock.now());
  }

  /** Carries a sign-in between its password step and its code step. */
  issueChallenge(userId: string): string {
    const expires = this.#clock.now().getTime() + CHALLENGE_TTL_MS;
    const payload = Buffer.from(JSON.stringify({ u: userId, e: expires })).toString("base64url");
    return `${payload}.${this.#sign(payload)}`;
  }

  /** The user a live challenge names; throws on anything forged, altered or stale. */
  redeemChallenge(token: string): string {
    const [payload, signature] = token.split(".");
    if (payload === undefined || signature === undefined || this.#sign(payload) !== signature) {
      throw MFA_CODE_INVALID;
    }
    try {
      const { u, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
        u: string;
        e: number;
      };
      if (typeof u !== "string" || typeof e !== "number" || e <= this.#clock.now().getTime()) {
        throw MFA_CODE_INVALID;
      }
      return u;
    } catch {
      throw MFA_CODE_INVALID;
    }
  }

  #sign(payload: string): string {
    return createHmac("sha256", this.#key).update(`challenge:${payload}`).digest("base64url");
  }

  #encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), body].map((part) => part.toString("base64url")).join(".");
  }

  #decrypt(stored: string): string {
    const [iv, tag, body] = stored.split(".").map((part) => Buffer.from(part, "base64url"));
    if (iv === undefined || tag === undefined || body === undefined) {
      throw new ConflictError("Stored two-factor secret is unreadable", {});
    }
    const decipher = createDecipheriv("aes-256-gcm", this.#key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  }
}

export type { MfaState };

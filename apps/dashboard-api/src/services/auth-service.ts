/**
 * Auth application service.
 *
 * One operation: `authenticate`, the password step. It does not issue a
 * session: an account with a second factor is not signed in by its password, so
 * the route decides between a session and a challenge. Returns `Effect` so the
 * route gets a typed `UnauthorizedError` for any failed login — and crucially, the
 * same `UnauthorizedError` with the same message for an unknown email and a
 * wrong password, so the response leaks no signal for user enumeration.
 *
 * An account that never confirmed its email is refused too, with a distinct
 * message — but only after the password has already verified, so that answer
 * costs an attacker the credential they did not have.
 */

import {
  InMemoryLoginFailures,
  type LoginFailures,
  type PasswordHasher,
  type User,
  type UserRepository,
} from "@mayarin/auth";
import { type Clock, RateLimitedError, systemClock, UnauthorizedError } from "@mayarin/shared";
import { Effect } from "effect";
import { EMAIL_NOT_VERIFIED } from "./registration-service.ts";

export interface AuthServiceOptions {
  readonly users: UserRepository;
  readonly hasher: PasswordHasher;
  readonly clock?: Clock;
  /** Where failed passwords are counted; per process unless a durable store is given. */
  readonly failures?: LoginFailures;
}

const INVALID_CREDENTIALS = new UnauthorizedError("Invalid email or password");

export class AuthService {
  readonly #users: UserRepository;
  readonly #hasher: PasswordHasher;
  /**
   * Verified against for an unknown email, so that answer costs the same
   * argon2 run as a wrong password. Without it the two differ by tens of
   * milliseconds and the response time is an enumeration oracle.
   */
  readonly #decoy: Promise<string>;
  readonly #clock: Clock;
  /**
   * Failed passwords per email (SEC-08), keyed by the email as typed, known or
   * not, so the wait is no enumeration oracle.
   */
  readonly #failures: LoginFailures;

  constructor(options: AuthServiceOptions) {
    this.#users = options.users;
    this.#hasher = options.hasher;
    this.#clock = options.clock ?? systemClock;
    this.#failures = options.failures ?? new InMemoryLoginFailures();
    this.#decoy = options.hasher.hash(crypto.randomUUID());
    // Rejected only if the hasher is broken; login reports that when it needs it.
    this.#decoy.catch(() => undefined);
  }

  /**
   * Verifies credentials and returns the account, without issuing a session.
   *
   * Split from `login` because an account with a second factor is not signed in
   * by its password alone: the route turns this into a challenge, and the
   * session is issued only after the code. Both failure modes — unknown email,
   * wrong password — reject with the same `INVALID_CREDENTIALS` error so the
   * wire response is identical and enumeration-proof.
   */
  authenticate(email: string, password: string): Effect.Effect<User, UnauthorizedError | Error> {
    const users = this.#users;
    const hasher = this.#hasher;
    const decoy = this.#decoy;
    const key = email.trim().toLowerCase();
    const failures = this.#failures;
    const clock = this.#clock;
    const tryRun = <T>(run: () => Promise<T>): Effect.Effect<T, Error> =>
      Effect.tryPromise({ try: run, catch: (error) => error as Error });

    return Effect.gen(function* () {
      // Before any hashing, so a blocked email costs the server nothing.
      const waitMs = yield* tryRun(() => failures.waitMs(key, clock.now()));
      if (waitMs > 0) {
        return yield* Effect.fail(
          new RateLimitedError("Too many failed sign-in attempts; try again later", {
            retryAfterSeconds: Math.ceil(waitMs / 1_000),
          }),
        );
      }
      const user = yield* tryRun(() => users.findByEmail(email));
      if (user === null) {
        yield* tryRun(async () => hasher.verify(password, await decoy));
        yield* tryRun(() => failures.record(key, clock.now()));
        return yield* Effect.fail(INVALID_CREDENTIALS);
      }

      const ok = yield* tryRun(() => hasher.verify(password, user.passwordHash));
      if (!ok) {
        yield* tryRun(() => failures.record(key, clock.now()));
        return yield* Effect.fail(INVALID_CREDENTIALS);
      }
      yield* tryRun(() => failures.clear(key));

      // Checked only after the password does, so the distinct answer is not an
      // enumeration oracle: reaching it already required the right credentials.
      if (user.emailVerifiedAt === undefined) return yield* Effect.fail(EMAIL_NOT_VERIFIED);
      return user;
    });
  }
}

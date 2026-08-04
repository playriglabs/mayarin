/**
 * Auth application service.
 *
 * One operation: `login`. It couples password verification to session issuance,
 * which is the only auth flow the dashboard has. Returns `Effect` so the route
 * gets a typed `UnauthorizedError` for any failed login — and crucially, the
 * same `UnauthorizedError` with the same message for an unknown email and a
 * wrong password, so the response leaks no signal for user enumeration.
 */

import type { PasswordHasher, Session, User, UserRepository } from "@mayarin/auth";
import { UnauthorizedError } from "@mayarin/shared";
import { Effect } from "effect";
import type { SessionService } from "./session-service.ts";

export interface AuthServiceOptions {
  readonly users: UserRepository;
  readonly hasher: PasswordHasher;
  readonly sessions: SessionService;
}

export interface LoginResult {
  readonly user: User;
  readonly session: Session;
}

const INVALID_CREDENTIALS = new UnauthorizedError("Invalid email or password");

export class AuthService {
  readonly #users: UserRepository;
  readonly #hasher: PasswordHasher;
  readonly #sessions: SessionService;

  constructor(options: AuthServiceOptions) {
    this.#users = options.users;
    this.#hasher = options.hasher;
    this.#sessions = options.sessions;
  }

  /**
   * Verifies credentials and issues a session. Both failure modes — unknown
   * email, wrong password — reject with the same `INVALID_CREDENTIALS` error so
   * the wire response is identical and enumeration-proof.
   */
  login(email: string, password: string): Effect.Effect<LoginResult, UnauthorizedError | Error> {
    const users = this.#users;
    const hasher = this.#hasher;
    const sessions = this.#sessions;
    const tryRun = <T>(run: () => Promise<T>): Effect.Effect<T, Error> =>
      Effect.tryPromise({ try: run, catch: (error) => error as Error });

    return Effect.gen(function* () {
      const user = yield* tryRun(() => users.findByEmail(email));
      if (user === null) return yield* Effect.fail(INVALID_CREDENTIALS);

      const ok = yield* tryRun(() => hasher.verify(password, user.passwordHash));
      if (!ok) return yield* Effect.fail(INVALID_CREDENTIALS);

      const session = yield* sessions.create(user.id);
      return { user, session };
    });
  }
}

/**
 * Session application service.
 *
 * Owns the session lifecycle: issue, verify, revoke. Verification is the
 * request-path hot spot, so it is a single repo read followed by pure validity
 * checks. Returns `Effect` so the route layer gets a typed `UnauthorizedError`
 * to hand to the error handler — no second mapping layer.
 *
 * Expiry is checked here, not by the repository: a row is returned regardless
 * and the service decides whether it is still live, so the same row can be
 * audited after expiry without a special read path.
 */

import { randomBytes } from "node:crypto";
import type { Session, SessionRepository, User, UserRepository } from "@mayarin/auth";
import { type Clock, generateId, UnauthorizedError } from "@mayarin/shared";
import { Effect } from "effect";

export interface SessionServiceOptions {
  readonly sessions: SessionRepository;
  readonly users: UserRepository;
  readonly clock: Clock;
  readonly ttlSeconds: number;
}

export interface VerifiedSession {
  readonly session: Session;
  readonly user: User;
}

export class SessionService {
  readonly #sessions: SessionRepository;
  readonly #users: UserRepository;
  readonly #clock: Clock;
  readonly #ttlSeconds: number;

  constructor(options: SessionServiceOptions) {
    this.#sessions = options.sessions;
    this.#users = options.users;
    this.#clock = options.clock;
    this.#ttlSeconds = options.ttlSeconds;
  }

  /** Issues a new session for `userId`. */
  create(userId: string): Effect.Effect<Session, Error> {
    const now = this.#clock.now();
    const session: Session = {
      id: generateId("ses", now.getTime()),
      userId,
      csrfToken: randomBytes(32).toString("base64url"),
      expiresAt: new Date(now.getTime() + this.#ttlSeconds * 1000),
      createdAt: now,
    };
    return Effect.tryPromise({
      try: async () => {
        await this.#sessions.insert(session);
        return session;
      },
      catch: (error) => error as Error,
    });
  }

  /**
   * Loads a session and its user, rejecting with `UnauthorizedError` when the
   * session is unknown, revoked, or past its expiry. A repo failure surfaces as
   * an `Error` so the error handler maps it to 500, not 401.
   */
  verify(sessionId: string): Effect.Effect<VerifiedSession, UnauthorizedError | Error> {
    const sessions = this.#sessions;
    const users = this.#users;
    const now = this.#clock.now().getTime();
    const tryRead = <T>(run: () => Promise<T>): Effect.Effect<T, Error> =>
      Effect.tryPromise({ try: run, catch: (error) => error as Error });

    return Effect.gen(function* () {
      const session = yield* tryRead(() => sessions.findById(sessionId));
      if (session === null) return yield* Effect.fail(new UnauthorizedError("Session not found"));
      if (session.revokedAt !== undefined)
        return yield* Effect.fail(new UnauthorizedError("Session revoked"));
      if (session.expiresAt.getTime() <= now)
        return yield* Effect.fail(new UnauthorizedError("Session expired"));

      const user = yield* tryRead(() => users.findById(session.userId));
      if (user === null)
        return yield* Effect.fail(new UnauthorizedError("Session user no longer exists"));
      return { session, user };
    });
  }

  /** Marks a session revoked at the current time. Unknown id → `UnauthorizedError`. */
  revoke(sessionId: string): Effect.Effect<void, UnauthorizedError | Error> {
    const sessions = this.#sessions;
    const tryRead = <T>(run: () => Promise<T>): Effect.Effect<T, Error> =>
      Effect.tryPromise({ try: run, catch: (error) => error as Error });
    const tryWrite = (run: () => Promise<void>): Effect.Effect<void, Error> =>
      Effect.tryPromise({ try: run, catch: (error) => error as Error });

    return Effect.gen(function* () {
      const session = yield* tryRead(() => sessions.findById(sessionId));
      if (session === null) return yield* Effect.fail(new UnauthorizedError("Session not found"));
      yield* tryWrite(() => sessions.revoke(sessionId, new Date()));
    });
  }
}

/**
 * Session/Auth service tests — the Effect layer.
 *
 * Verifies the session lifecycle (issue/verify/revoke/expiry) and the auth
 * enumeration-proofing: unknown email and wrong password reject with the same
 * `UnauthorizedError` and the same message.
 */

import { describe, expect, test } from "bun:test";
import type { User } from "@mayarin/auth";
import { InMemorySessionRepository, InMemoryUserRepository } from "@mayarin/auth/testing";
import { FixedClock, generateId } from "@mayarin/shared";
import { Effect } from "effect";
import { AuthService } from "../src/services/auth-service.ts";
import { SessionService } from "../src/services/session-service.ts";

class PlainHasher {
  async hash(plain: string): Promise<string> {
    return `plain:${plain}`;
  }
  async verify(plain: string, hashed: string): Promise<boolean> {
    return hashed === `plain:${plain}`;
  }
}

function makeUser(clock: FixedClock, email = "admin@mayarin.local"): User {
  const now = clock.now();
  return {
    id: generateId("usr", now.getTime()),
    email,
    passwordHash: "plain:correct-horse-battery-staple",
    merchantId: "mrc_test",
    permissions: ["payments:read", "users:manage", "admin:access"] as const,
    emailVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

describe("SessionService", () => {
  test("create then verify round-trips the session and user", async () => {
    const clock = new FixedClock("2026-01-01T00:00:00.000Z");
    const users = new InMemoryUserRepository();
    const sessions = new InMemorySessionRepository();
    const user = makeUser(clock);
    await users.insert(user);

    const service = new SessionService({
      sessions,
      users,
      clock,
      ttlSeconds: 3600,
      idleSeconds: 1800,
    });
    const session = await Effect.runPromise(service.create(user.id));
    expect(session.id.startsWith("ses_")).toBe(true);
    expect(session.userId).toBe(user.id);

    const verified = await Effect.runPromise(service.verify(session.id));
    expect(verified.session.id).toBe(session.id);
    expect(verified.user.id).toBe(user.id);
  });

  test("a session unused past the idle limit is signed out, one in use is kept alive (SEC-15)", async () => {
    const clock = new FixedClock("2026-01-01T00:00:00.000Z");
    const users = new InMemoryUserRepository();
    const sessions = new InMemorySessionRepository();
    const user = makeUser(clock);
    await users.insert(user);
    const service = new SessionService({
      sessions,
      users,
      clock,
      ttlSeconds: 86_400,
      idleSeconds: 1800,
    });
    const idle = await Effect.runPromise(service.create(user.id));
    const active = await Effect.runPromise(service.create(user.id));

    // Twenty minutes in, the active session is used; the other is not.
    clock.advance(20 * 60_000);
    await Effect.runPromise(service.verify(active.id));
    // Another twenty: forty since the idle one was created, twenty since the active one was used.
    clock.advance(20 * 60_000);

    await expect(Effect.runPromise(service.verify(idle.id))).rejects.toThrow(
      "Session idle too long",
    );
    await expect(Effect.runPromise(service.verify(active.id))).resolves.toBeDefined();
  });

  test("verify rejects an unknown session with UnauthorizedError", async () => {
    const clock = new FixedClock("2026-01-01T00:00:00.000Z");
    const service = new SessionService({
      sessions: new InMemorySessionRepository(),
      users: new InMemoryUserRepository(),
      clock,
      ttlSeconds: 3600,
      idleSeconds: 1800,
    });
    await expect(Effect.runPromise(service.verify("ses_unknown"))).rejects.toThrow(
      "Session not found",
    );
  });

  test("verify rejects a revoked session", async () => {
    const clock = new FixedClock("2026-01-01T00:00:00.000Z");
    const users = new InMemoryUserRepository();
    const sessions = new InMemorySessionRepository();
    const user = makeUser(clock);
    await users.insert(user);
    const service = new SessionService({
      sessions,
      users,
      clock,
      ttlSeconds: 3600,
      idleSeconds: 1800,
    });

    const session = await Effect.runPromise(service.create(user.id));
    await Effect.runPromise(service.revoke(session.id));
    await expect(Effect.runPromise(service.verify(session.id))).rejects.toThrow("Session revoked");
  });

  test("verify rejects an expired session", async () => {
    const clock = new FixedClock("2026-01-01T00:00:00.000Z");
    const users = new InMemoryUserRepository();
    const sessions = new InMemorySessionRepository();
    const user = makeUser(clock);
    await users.insert(user);
    const service = new SessionService({
      sessions,
      users,
      clock,
      ttlSeconds: 1,
      idleSeconds: 1800,
    });

    const session = await Effect.runPromise(service.create(user.id));
    clock.advance(2000); // past the 1-second TTL
    await expect(Effect.runPromise(service.verify(session.id))).rejects.toThrow("Session expired");
  });

  test("revoke rejects an unknown session", async () => {
    const clock = new FixedClock("2026-01-01T00:00:00.000Z");
    const service = new SessionService({
      sessions: new InMemorySessionRepository(),
      users: new InMemoryUserRepository(),
      clock,
      ttlSeconds: 3600,
      idleSeconds: 1800,
    });
    await expect(Effect.runPromise(service.revoke("ses_unknown"))).rejects.toThrow(
      "Session not found",
    );
  });
});

describe("AuthService.authenticate", () => {
  test("returns the account for valid credentials", async () => {
    const clock = new FixedClock("2026-01-01T00:00:00.000Z");
    const users = new InMemoryUserRepository();
    const user = makeUser(clock);
    await users.insert(user);

    const auth = new AuthService({ users, hasher: new PlainHasher() });

    const result = await Effect.runPromise(
      auth.authenticate(user.email, "correct-horse-battery-staple"),
    );
    expect(result.id).toBe(user.id);
  });

  test("rejects a wrong password with the constant credentials message", async () => {
    const clock = new FixedClock("2026-01-01T00:00:00.000Z");
    const users = new InMemoryUserRepository();
    await users.insert(makeUser(clock));

    const auth = new AuthService({ users, hasher: new PlainHasher() });

    await expect(
      Effect.runPromise(auth.authenticate("admin@mayarin.local", "wrong-password")),
    ).rejects.toThrow("Invalid email or password");
  });

  test("rejects an unknown email with the same message as a wrong password", async () => {
    const users = new InMemoryUserRepository();

    const auth = new AuthService({ users, hasher: new PlainHasher() });

    await expect(
      Effect.runPromise(auth.authenticate("nobody@mayarin.local", "anything")),
    ).rejects.toThrow("Invalid email or password");
  });
});

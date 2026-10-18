import { describe, expect, test } from "bun:test";
import type { PasswordHasher, UserRepository } from "@mayarin/auth";
import { FixedClock } from "@mayarin/shared";
import { Effect } from "effect";
import { AuthService } from "../src/services/auth-service.ts";

class CountingHasher implements PasswordHasher {
  verifies = 0;
  async hash(plain: string): Promise<string> {
    return `hash:${plain}`;
  }
  async verify(plain: string, hashed: string): Promise<boolean> {
    this.verifies += 1;
    return hashed === `hash:${plain}`;
  }
}

describe("AuthService login timing", () => {
  test("an unknown email runs the same password verification as a wrong password", async () => {
    const hasher = new CountingHasher();
    const known = { id: "usr_1", passwordHash: "hash:right", emailVerifiedAt: new Date() };
    const users = {
      async findByEmail(email: string) {
        return email === "known@example.com" ? known : null;
      },
    } as unknown as UserRepository;
    const service = new AuthService({
      users,
      hasher,
    });

    await Effect.runPromiseExit(service.authenticate("known@example.com", "wrong"));
    const afterWrongPassword = hasher.verifies;
    await Effect.runPromiseExit(service.authenticate("nobody@example.com", "wrong"));

    expect(afterWrongPassword).toBe(1);
    expect(hasher.verifies - afterWrongPassword).toBe(1);
  });
});

describe("AuthService failed-login backoff (SEC-08)", () => {
  const known = { id: "usr_1", passwordHash: "hash:right", emailVerifiedAt: new Date() };
  const users = {
    async findByEmail(email: string) {
      return email === "known@example.com" ? known : null;
    },
  } as unknown as UserRepository;

  function build() {
    const hasher = new CountingHasher();
    const clock = new FixedClock(new Date("2026-01-01T00:00:00Z"));
    return { service: new AuthService({ users, hasher, clock }), hasher, clock };
  }

  const attempt = (service: AuthService, email: string, password: string) =>
    Effect.runPromiseExit(service.authenticate(email, password));

  async function fail(service: AuthService, email: string, times: number) {
    for (let i = 0; i < times; i += 1) await attempt(service, email, "wrong");
  }

  test("blocks an email after five failures, before hashing, even with the right password", async () => {
    const { service, hasher } = build();
    await fail(service, "known@example.com", 5);
    const verifiesBefore = hasher.verifies;

    const exit = await attempt(service, "known@example.com", "right");

    expect(JSON.stringify(exit)).toContain("RATE_LIMITED");
    expect(hasher.verifies).toBe(verifiesBefore);
  });

  test("blocks an unknown email the same way, so the wait is no enumeration oracle", async () => {
    const { service } = build();
    await fail(service, "nobody@example.com", 5);

    const exit = await attempt(service, "nobody@example.com", "wrong");

    expect(JSON.stringify(exit)).toContain("RATE_LIMITED");
  });

  test("lets the right password in once the wait is over, and forgets the failures", async () => {
    const { service, clock } = build();
    await fail(service, "known@example.com", 5);
    clock.advance(31_000);

    const ok = await attempt(service, "known@example.com", "right");
    expect(ok._tag).toBe("Success");

    await fail(service, "known@example.com", 4);
    expect((await attempt(service, "known@example.com", "right"))._tag).toBe("Success");
  });

  test("doubles the wait with each further failure, up to a ceiling", async () => {
    const { service, clock } = build();
    await fail(service, "known@example.com", 5);
    clock.advance(31_000);
    await attempt(service, "known@example.com", "wrong"); // sixth: 60 s
    clock.advance(31_000);
    expect(JSON.stringify(await attempt(service, "known@example.com", "right"))).toContain(
      "RATE_LIMITED",
    );
    clock.advance(30_000);
    expect((await attempt(service, "known@example.com", "right"))._tag).toBe("Success");
  });

  test("one email's failures do not block another", async () => {
    const { service } = build();
    await fail(service, "nobody@example.com", 6);
    expect((await attempt(service, "known@example.com", "right"))._tag).toBe("Success");
  });
});

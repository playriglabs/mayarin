import { describe, expect, test } from "bun:test";
import type { PasswordHasher, UserRepository } from "@mayarin/auth";
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
      sessions: undefined as never,
    });

    await Effect.runPromiseExit(service.login("known@example.com", "wrong"));
    const afterWrongPassword = hasher.verifies;
    await Effect.runPromiseExit(service.login("nobody@example.com", "wrong"));

    expect(afterWrongPassword).toBe(1);
    expect(hasher.verifies - afterWrongPassword).toBe(1);
  });
});

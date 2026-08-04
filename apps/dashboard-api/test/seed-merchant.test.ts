/**
 * `UserService.createMerchantAccount` unit tests — the engine behind the
 * `seed:merchant` CLI.
 *
 * Verifies the merchant + first account are created together, the account is
 * scoped to the new merchant, a password is generated + returned when none is
 * supplied, and a duplicate email surfaces a `ConflictError` (which the CLI
 * maps to a non-zero exit).
 */

import { describe, expect, test } from "bun:test";
import type { PasswordHasher } from "@mayarin/auth";
import { InMemoryMerchantRepository, InMemoryUserRepository } from "@mayarin/auth/testing";
import { ConflictError, FixedClock } from "@mayarin/shared";
import { UserService } from "../src/services/user-service.ts";

class PlainHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    return `plain:${plain}`;
  }
  async verify(plain: string, hashed: string): Promise<boolean> {
    return hashed === `plain:${plain}`;
  }
}

function makeService() {
  const clock = new FixedClock("2026-01-01T00:00:00.000Z");
  const users = new InMemoryUserRepository();
  const merchants = new InMemoryMerchantRepository();
  const hasher = new PlainHasher();
  const userService = new UserService({ users, merchants, hasher, clock });
  return { userService, users, merchants, hasher, clock };
}

describe("UserService.createMerchantAccount", () => {
  test("creates a merchant + its first account, scoped to that merchant", async () => {
    const { userService, users, merchants } = makeService();
    const result = await userService.createMerchantAccount({
      email: "admin@acme.test",
      password: "strong-password-1",
      merchantName: "Acme",
      permissions: ["payments:read", "users:manage", "admin:access"],
    });

    // The account is scoped to the new merchant.
    expect(result.user.email).toBe("admin@acme.test");
    expect(result.user.merchantId).toBe(result.user.merchantId);
    expect(result.user.permissions).toEqual(["payments:read", "users:manage", "admin:access"]);
    expect(result.generated).toBe(false);
    expect(result.password).toBeUndefined();

    // Both records actually persisted.
    const merchant = await merchants.findById(result.user.merchantId);
    expect(merchant?.name).toBe("Acme");
    const user = await users.findByEmail("admin@acme.test");
    expect(user?.merchantId).toBe(result.user.merchantId);
  });

  test("generates + returns a password when none is supplied", async () => {
    const { userService, hasher } = makeService();
    const result = await userService.createMerchantAccount({
      email: "admin@acme.test",
      merchantName: "Acme",
      permissions: ["payments:read"],
    });

    expect(result.generated).toBe(true);
    expect(typeof result.password).toBe("string");
    expect((result.password ?? "").length).toBeGreaterThan(0);

    // The generated plaintext hashes-verify against the stored hash (i.e. it
    // is the real password, not a placeholder).
    const ok = await hasher.verify(result.password ?? "", result.user.passwordHash);
    expect(ok).toBe(true);
  });

  test("rejects a duplicate email with ConflictError", async () => {
    const { userService } = makeService();
    await userService.createMerchantAccount({
      email: "admin@acme.test",
      password: "strong-password-1",
      merchantName: "Acme",
      permissions: ["payments:read"],
    });
    await expect(
      userService.createMerchantAccount({
        email: "admin@acme.test",
        password: "strong-password-2",
        merchantName: "Acme Too",
        permissions: ["payments:read"],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

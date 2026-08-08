import { describe, expect, test } from "bun:test";
import type { MerchantRepository } from "../src/merchant.ts";
import type { PasswordHasher } from "../src/password.ts";
import type { SessionRepository, UserRepository } from "../src/repository.ts";
import type { Session, User } from "../src/types.ts";

const now = new Date("2026-01-01T00:00:00.000Z");

describe("auth domain types", () => {
  test("a merchant user is scoped to a merchant id and carries permissions", () => {
    const user: User = {
      id: "usr_01J8Z3K4M5N6P7Q8R9S0T1U2V4",
      email: "merchant@warungkopi.id",
      passwordHash: "$argon2id$…",
      merchantId: "M-1",
      permissions: ["payments:read"],
      createdAt: now,
      updatedAt: now,
    };
    expect(user.merchantId).toBe("M-1");
    expect(user.permissions).toEqual(["payments:read"]);
  });

  test("a merchant-admin carries the manage/admin permissions", () => {
    const admin: User = {
      id: "usr_01J8Z3K4M5N6P7Q8R9S0T1U2V5",
      email: "admin@warungkopi.id",
      passwordHash: "$argon2id$…",
      merchantId: "M-1",
      permissions: ["payments:read", "users:manage", "admin:access"],
      createdAt: now,
      updatedAt: now,
    };
    expect(admin.permissions).toContain("users:manage");
    expect(admin.permissions).toContain("admin:access");
  });

  test("a live session has no revokedAt, a revoked one does", () => {
    const live: Session = {
      id: "ses_01J8Z3K4M5N6P7Q8R9S0T1U2V3",
      userId: "usr_01J8Z3K4M5N6P7Q8R9S0T1U2V3",
      csrfToken: "token",
      expiresAt: new Date("2026-01-08T00:00:00.000Z"),
      createdAt: now,
    };
    const revoked: Session = { ...live, revokedAt: now };
    expect(live.revokedAt).toBeUndefined();
    expect(revoked.revokedAt).toBe(now);
  });

  test("a fake hasher and the repository interfaces compile against their ports", () => {
    // Compile-time check: these implementations must satisfy the ports.
    const hasher: PasswordHasher = {
      async hash(plain: string) {
        return `fake:${plain}`;
      },
      async verify(plain: string, hashed: string) {
        return hashed === `fake:${plain}`;
      },
    };
    const users: UserRepository = {
      async findById() {
        return null;
      },
      async findByEmail() {
        return null;
      },
      async insert(user: User) {
        return user;
      },
      async listByMerchant() {
        return [];
      },
      async touchUpdatedAt() {},
    };
    const sessions: SessionRepository = {
      async insert(session: Session) {
        return session;
      },
      async findById() {
        return null;
      },
      async revoke() {},
      async deleteExpired() {
        return 0;
      },
    };
    const merchants: MerchantRepository = {
      async insert(merchant) {
        return merchant;
      },
      async findById() {
        return null;
      },
      async update() {},
      async list() {
        return [];
      },
    };
    expect(hasher).toBeDefined();
    expect(users).toBeDefined();
    expect(sessions).toBeDefined();
    expect(merchants).toBeDefined();
  });
});

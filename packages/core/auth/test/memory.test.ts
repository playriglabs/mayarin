import { describe, expect, test } from "bun:test";
import { ConflictError, FixedClock, generateId } from "@mayarin/shared";
import type { Merchant, Session, User } from "../src/index.ts";
import {
  InMemoryMerchantRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
} from "../testing/index.ts";

const clock = new FixedClock("2026-01-01T00:00:00.000Z");

function makeUser(overrides: Partial<User> & { email: string; merchantId: string }): User {
  const now = clock.now();
  return {
    id: generateId("usr", now.getTime()),
    passwordHash: "$argon2id$hashed",
    permissions: ["payments:read"],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeMerchant(name: string): Merchant {
  const now = clock.now();
  return {
    id: generateId("mrc", now.getTime()),
    name,
    settlementAsset: "USDC",
    acceptedAssets: ["ETH", "USDC"],
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

function makeSession(userId: string, overrides: Partial<Session> = {}): Session {
  return {
    id: generateId("ses", clock.now().getTime()),
    userId,
    csrfToken: "csrf-token",
    expiresAt: new Date("2026-01-08T00:00:00.000Z"),
    createdAt: clock.now(),
    ...overrides,
  };
}

describe("InMemoryUserRepository", () => {
  test("inserts and finds by id and email", async () => {
    const repo = new InMemoryUserRepository();
    const user = makeUser({ email: "admin@mayarin.local", merchantId: "M-1" });
    await repo.insert(user);

    expect(await repo.findById(user.id)).toEqual(user);
    expect((await repo.findByEmail("admin@mayarin.local"))?.id).toBe(user.id);
    expect(await repo.findByEmail("nobody@mayarin.local")).toBeNull();
  });

  test("rejects a duplicate email", async () => {
    const repo = new InMemoryUserRepository();
    await repo.insert(makeUser({ email: "dup@mayarin.local", merchantId: "M-1" }));
    await expect(
      repo.insert(makeUser({ email: "dup@mayarin.local", merchantId: "M-1" })),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("lists users by merchant", async () => {
    const repo = new InMemoryUserRepository();
    await repo.insert(makeUser({ email: "a1@mayarin.local", merchantId: "M-1" }));
    await repo.insert(makeUser({ email: "a2@mayarin.local", merchantId: "M-1" }));
    await repo.insert(makeUser({ email: "b1@mayarin.local", merchantId: "M-2" }));

    expect((await repo.listByMerchant("M-1")).length).toBe(2);
    expect((await repo.listByMerchant("M-2")).length).toBe(1);
    expect((await repo.listByMerchant("M-9")).length).toBe(0);
  });

  test("touchUpdatedAt advances the timestamp", async () => {
    const repo = new InMemoryUserRepository();
    const user = makeUser({ email: "t@mayarin.local", merchantId: "M-1" });
    await repo.insert(user);
    const later = new Date("2026-02-01T00:00:00.000Z");
    await repo.touchUpdatedAt(user.id, later);
    expect((await repo.findById(user.id))?.updatedAt).toEqual(later);
  });
});

describe("InMemoryMerchantRepository", () => {
  test("inserts and finds by id", async () => {
    const repo = new InMemoryMerchantRepository();
    const merchant = makeMerchant("Acme");
    await repo.insert(merchant);
    expect(await repo.findById(merchant.id)).toEqual(merchant);
    expect(await repo.findById("mrc_unknown")).toBeNull();
  });

  test("rejects a duplicate id", async () => {
    const repo = new InMemoryMerchantRepository();
    const merchant = makeMerchant("Acme");
    await repo.insert(merchant);
    await expect(repo.insert(merchant)).rejects.toBeInstanceOf(ConflictError);
  });

  test("lists all merchants", async () => {
    const repo = new InMemoryMerchantRepository();
    await repo.insert(makeMerchant("Acme"));
    await repo.insert(makeMerchant("Beta"));
    expect((await repo.list()).length).toBe(2);
  });
});

describe("InMemorySessionRepository", () => {
  test("inserts and finds a session", async () => {
    const repo = new InMemorySessionRepository();
    const user = makeUser({ email: "u@mayarin.local", merchantId: "M-1" });
    const session = makeSession(user.id);
    await repo.insert(session);

    expect(await repo.findById(session.id)).toEqual(session);
    expect(await repo.findById("ses_unknown")).toBeNull();
  });

  test("revoke marks revokedAt without deleting", async () => {
    const repo = new InMemorySessionRepository();
    const user = makeUser({ email: "r@mayarin.local", merchantId: "M-1" });
    const session = makeSession(user.id);
    await repo.insert(session);

    const revokedAt = new Date("2026-01-02T00:00:00.000Z");
    await repo.revoke(session.id, revokedAt);
    const found = await repo.findById(session.id);
    expect(found?.revokedAt).toEqual(revokedAt);
  });

  test("deleteExpired removes only past sessions and returns the count", async () => {
    const repo = new InMemorySessionRepository();
    const user = makeUser({ email: "e@mayarin.local", merchantId: "M-1" });
    await repo.insert(makeSession(user.id, { expiresAt: new Date("2025-12-01T00:00:00.000Z") }));
    const live = makeSession(user.id, { expiresAt: new Date("2026-12-01T00:00:00.000Z") });
    await repo.insert(live);

    const deleted = await repo.deleteExpired(new Date("2026-01-01T00:00:00.000Z"));
    expect(deleted).toBe(1);
    // The expired session is gone; the future one is still findable.
    expect(await repo.findById(live.id)).toEqual(live);
  });
});

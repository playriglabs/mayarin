/**
 * Merchant settings route tests (#95).
 *
 * The surface that replaced `UPDATE merchants SET settlement_address = …` in a
 * psql session. What is under test is mostly *refusal*: the wrong permission,
 * the wrong merchant, a malformed address, a missing CSRF token — because this
 * route decides where a merchant's money is paid.
 */

import { describe, expect, test } from "bun:test";
import type { Permission, User } from "@mayarin/auth";
import { ConcurrencyError, generateId } from "@mayarin/shared";
import { cookieJar, createDashboardHarness } from "./harness.ts";

const ADMIN_EMAIL = "admin@mayarin.local";
const ADMIN_PASSWORD = "correct-horse-battery-staple";
const ADDRESS = "0x1111111111111111111111111111111111111111";
const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222";
/** Stands in for a Safe this deployment provisioned for the merchant. */
const MANAGED_ADDRESS = "0x3333333333333333333333333333333333333333";

type Harness = Awaited<ReturnType<typeof createDashboardHarness>>;

async function seed() {
  return createDashboardHarness({ adminEmail: ADMIN_EMAIL, adminPassword: ADMIN_PASSWORD });
}

async function insertUser(
  harness: Harness,
  email: string,
  password: string,
  permissions: readonly Permission[],
  merchantId = harness.merchantId,
): Promise<User> {
  const now = harness.clock.now();
  const user: User = {
    id: generateId("usr", now.getTime()),
    email,
    passwordHash: `plain:${password}`,
    merchantId,
    permissions: [...permissions],
    createdAt: now,
    updatedAt: now,
  };
  await harness.users.insert(user);
  return user;
}

async function loginAs(harness: Harness, email: string, password: string) {
  const res = await harness.request("POST", "/auth/login", { body: { email, password } });
  expect(res.status).toBe(200);
  const jar = cookieJar(res.setCookies);
  return { jar, csrf: jar.mayarin_csrf ?? "" };
}

async function patch(
  harness: Harness,
  auth: { jar: Record<string, string>; csrf: string },
  body: unknown,
) {
  return harness.request("PATCH", "/settings", {
    body,
    cookies: auth.jar,
    headers: { "x-csrf-token": auth.csrf },
  });
}

describe("GET /settings", () => {
  test("returns the caller's own merchant settings", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const { status, body } = await harness.request("GET", "/settings", { cookies: auth.jar });

    expect(status).toBe(200);
    expect(body?.settings).toMatchObject({
      merchantId: harness.merchantId,
      settlementAsset: "USDC",
      settlementAddress: null,
      // No address and no managed wallet: nowhere to pay, so nothing to sign.
      effectiveSettlementAddress: null,
      canSettleOnChain: false,
    });
  });

  test("no chosen address falls back to the managed wallet (#11)", async () => {
    // "Blank" is not "nowhere". A merchant provisioned a Safe is paid at it, and
    // a screen reporting them unable to settle would send them looking for a
    // setting that does not need changing.
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const now = harness.clock.now();
    await harness.merchantWallets.insert({
      id: generateId("wlt", now.getTime()),
      merchantId: harness.merchantId,
      chain: "base-sepolia",
      address: MANAGED_ADDRESS,
      provenance: "provisioned",
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const { body } = await harness.request("GET", "/settings", { cookies: auth.jar });

    expect(body?.settings.settlementAddress).toBeNull();
    expect(body?.settings.effectiveSettlementAddress).toBe(MANAGED_ADDRESS);
    expect(body?.settings.canSettleOnChain).toBe(true);
  });

  test("a chosen address wins over the managed wallet", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const now = harness.clock.now();
    await harness.merchantWallets.insert({
      id: generateId("wlt", now.getTime()),
      merchantId: harness.merchantId,
      chain: "base-sepolia",
      address: MANAGED_ADDRESS,
      provenance: "provisioned",
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await patch(harness, auth, { settlementAddress: ADDRESS });

    const { body } = await harness.request("GET", "/settings", { cookies: auth.jar });

    expect(body?.settings.effectiveSettlementAddress).toBe(ADDRESS);
  });

  test("an anonymous caller is refused", async () => {
    const harness = await seed();
    const { status } = await harness.request("GET", "/settings");
    expect(status).toBe(401);
  });

  test("a caller without settings:manage is refused", async () => {
    const harness = await seed();
    await insertUser(harness, "reader@mayarin.local", "reader-password-1", ["payments:read"]);
    const auth = await loginAs(harness, "reader@mayarin.local", "reader-password-1");

    const { status } = await harness.request("GET", "/settings", { cookies: auth.jar });
    expect(status).toBe(403);
  });
});

describe("PATCH /settings", () => {
  test("sets the settlement address a contract-path payment needs", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const { status, body } = await patch(harness, auth, { settlementAddress: ADDRESS });

    expect(status).toBe(200);
    expect(body?.settings).toMatchObject({
      settlementAddress: ADDRESS,
      canSettleOnChain: true,
    });
  });

  test("the merchant profile is edited here, and unlocks payment links (#15)", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    // A merchant created without a profile — what a bare seed produces.
    await harness.container.settings.update(
      { merchantId: harness.merchantId, permissions: new Set() },
      "usr_setup",
      { city: null, countryCode: null },
    );

    const before = await harness.request("GET", "/settings", { cookies: auth.jar });
    expect(before.body?.settings.canCreateLinks).toBe(false);

    const { status, body } = await patch(harness, auth, { city: "Bandung", countryCode: "id" });

    expect(status).toBe(200);
    // Uppercased on the way in: the EMVCo tag it ends up in is fixed-width, so
    // a lowercase code stored here is a QR a terminal reads differently.
    expect(body?.settings).toMatchObject({
      city: "Bandung",
      countryCode: "ID",
      canCreateLinks: true,
    });
  });

  test("a three-letter country code is refused", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const { status } = await patch(harness, auth, { countryCode: "IDN" });
    expect(status).toBe(400);
  });

  test("records who changed it and what it was", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    await patch(harness, auth, { settlementAddress: ADDRESS });
    const { body } = await harness.request("GET", "/settings/history", { cookies: auth.jar });

    expect(body?.changes).toHaveLength(1);
    expect(body?.changes[0]).toMatchObject({
      field: "settlementAddress",
      previousValue: null,
      nextValue: ADDRESS,
    });
    expect(body?.changes[0].changedBy).toMatch(/^usr_/);
  });

  test("clearing an address is distinct from leaving it alone", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    await patch(harness, auth, { settlementAddress: ADDRESS });
    const untouched = await patch(harness, auth, { settlementAsset: "USDT" });
    expect(untouched.body?.settings.settlementAddress).toBe(ADDRESS);

    const cleared = await patch(harness, auth, { settlementAddress: null });
    expect(cleared.body?.settings.settlementAddress).toBeNull();
    expect(cleared.body?.settings.canSettleOnChain).toBe(false);
  });

  test("a malformed address is refused at the write, not at PRICE_LOCKED", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const { status } = await patch(harness, auth, { settlementAddress: "0xnope" });

    expect(status).toBe(400);
    const after = await harness.request("GET", "/settings", { cookies: auth.jar });
    expect(after.body?.settings.settlementAddress).toBeNull();
  });

  test("the zero address is refused", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { status } = await patch(harness, auth, {
      settlementAddress: `0x${"0".repeat(40)}`,
    });
    expect(status).toBe(400);
  });

  test("a non-stablecoin settlement asset is refused", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { status } = await patch(harness, auth, { settlementAsset: "ETH" });
    expect(status).toBe(400);
  });

  test("the settlement asset stays in the accepted set", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const { body } = await patch(harness, auth, { acceptedAssets: ["ETH"] });

    expect(body?.settings.acceptedAssets).toEqual(["USDC", "ETH"]);
  });

  test("an unchanged patch writes no audit entry", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const { body } = await patch(harness, auth, { settlementAsset: "USDC" });

    expect(body?.changes).toEqual([]);
    const history = await harness.request("GET", "/settings/history", { cookies: auth.jar });
    expect(history.body?.changes).toEqual([]);
  });

  test("a missing CSRF token is refused", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const { status } = await harness.request("PATCH", "/settings", {
      body: { settlementAddress: ADDRESS },
      cookies: auth.jar,
    });
    expect(status).toBe(403);
  });

  test("a caller without settings:manage cannot write", async () => {
    const harness = await seed();
    await insertUser(harness, "reader@mayarin.local", "reader-password-1", [
      "payments:read",
      "admin:access",
    ]);
    const auth = await loginAs(harness, "reader@mayarin.local", "reader-password-1");

    const { status } = await patch(harness, auth, { settlementAddress: ADDRESS });
    expect(status).toBe(403);
  });

  test("a merchant id in the body is rejected rather than honoured", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const { status } = await patch(harness, auth, {
      merchantId: "mrc_someone_else",
      settlementAddress: ADDRESS,
    });

    // `.strict()` on the schema: an unknown key is a 400, not a silently
    // ignored field that a reader would assume had been applied.
    expect(status).toBe(400);
  });
});

describe("concurrent edits", () => {
  test("a stale write loses rather than overwriting the one that landed first", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const before = await harness.merchants.findById(harness.merchantId);
    expect(before).not.toBeNull();

    await patch(harness, auth, { settlementAddress: ADDRESS });

    // The version the first caller read, replayed — what a second tab holding a
    // stale copy of the settings page would send.
    if (before === null) throw new Error("merchant missing");
    await expect(
      harness.merchants.update({ ...before, settlementAddress: OTHER_ADDRESS }, before.version),
    ).rejects.toBeInstanceOf(ConcurrencyError);

    const after = await harness.merchants.findById(harness.merchantId);
    expect(after?.settlementAddress).toBe(ADDRESS);
  });

  test("each accepted edit bumps the version", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    await patch(harness, auth, { settlementAddress: ADDRESS });
    await patch(harness, auth, { settlementAsset: "USDT" });

    const merchant = await harness.merchants.findById(harness.merchantId);
    expect(merchant?.version).toBe(3);
  });
});

describe("cross-tenant isolation", () => {
  test("one merchant's write does not touch another's settings", async () => {
    const harness = await seed();

    const otherSeed = await harness.container.users.createMerchantAccount({
      email: "other@mayarin.local",
      password: "other-password-12345",
      merchantName: "Other",
      settlementAsset: "USDC",
      acceptedAssets: [],
      permissions: ["settings:manage"],
    });

    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    await patch(harness, auth, { settlementAddress: ADDRESS });

    const other = await harness.merchants.findById(otherSeed.user.merchantId);
    expect(other?.settlementAddress).toBeUndefined();
  });

  test("history is scoped to the caller's own merchant", async () => {
    const harness = await seed();

    const otherSeed = await harness.container.users.createMerchantAccount({
      email: "other@mayarin.local",
      password: "other-password-12345",
      merchantName: "Other",
      settlementAsset: "USDC",
      acceptedAssets: [],
      permissions: ["settings:manage"],
    });

    const mine = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    await patch(harness, mine, { settlementAddress: ADDRESS });

    const theirs = await loginAs(harness, "other@mayarin.local", "other-password-12345");
    const { body } = await harness.request("GET", "/settings/history", { cookies: theirs.jar });

    expect(body?.changes).toEqual([]);
    expect(otherSeed.user.merchantId).not.toBe(harness.merchantId);
  });
});

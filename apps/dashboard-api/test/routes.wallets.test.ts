/**
 * Merchant wallet route tests (#11).
 *
 * Signatures here are produced by a real key, because the whole claim is that
 * "verified" means a signature was recovered and matched. A stubbed verifier
 * would let these pass while the property they assert was false.
 */

import { describe, expect, test } from "bun:test";
import { generateId } from "@mayarin/shared";
import { privateKeyToAccount } from "viem/accounts";
import { cookieJar, createDashboardHarness } from "./harness.ts";

const ADMIN_EMAIL = "admin@mayarin.local";
const ADMIN_PASSWORD = "correct-horse-battery-staple";
const MERCHANT_KEY = `0x${"11".repeat(32)}` as const;
const OTHER_KEY = `0x${"22".repeat(32)}` as const;

type Harness = Awaited<ReturnType<typeof createDashboardHarness>>;

async function seed() {
  return createDashboardHarness({ adminEmail: ADMIN_EMAIL, adminPassword: ADMIN_PASSWORD });
}

async function loginAs(harness: Harness, email: string, password: string) {
  const res = await harness.request("POST", "/auth/login", { body: { email, password } });
  const jar = cookieJar(res.setCookies);
  return { jar, csrf: jar.mayarin_csrf ?? "" };
}

type Auth = Awaited<ReturnType<typeof loginAs>>;

async function post(harness: Harness, auth: Auth, path: string, body: unknown = {}) {
  return harness.request("POST", path, {
    body,
    cookies: auth.jar,
    headers: { "x-csrf-token": auth.csrf },
  });
}

/** Links the merchant key's address and returns the wallet id. */
async function link(harness: Harness, auth: Auth) {
  const account = privateKeyToAccount(MERCHANT_KEY);
  const res = await post(harness, auth, "/wallets", {
    chain: "base-sepolia",
    address: account.address,
  });
  // Read defensively: a duplicate claim answers 409 with no wallet, and the
  // helper is used by the test that asserts exactly that.
  return { id: (res.body?.wallet?.id ?? "") as string, account, res };
}

describe("linking", () => {
  test("a linked wallet starts unverified", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const { res } = await link(harness, auth);

    expect(res.status).toBe(201);
    // Linking is a claim. The guard does not accept claims.
    expect(res.body?.wallet.verified).toBe(false);
    expect(res.body?.wallet.provenance).toBe("linked");
  });

  test("the address is stored lowercased", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const account = privateKeyToAccount(MERCHANT_KEY);

    const res = await post(harness, auth, "/wallets", {
      chain: "base-sepolia",
      address: account.address.toUpperCase().replace("0X", "0x"),
    });

    expect(res.body?.wallet.address).toBe(account.address.toLowerCase());
  });

  test("a malformed address is refused", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const res = await post(harness, auth, "/wallets", {
      chain: "base-sepolia",
      address: "0xnope",
    });
    expect(res.status).toBe(400);
  });

  test("an address already claimed is refused", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    await link(harness, auth);

    const again = await link(harness, auth);
    expect(again.res.status).toBe(409);
  });
});

describe("proving control", () => {
  test("a signature from the address verifies the wallet", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { id, account } = await link(harness, auth);

    const challenge = await post(harness, auth, `/wallets/${id}/challenge`);
    const signature = await account.signMessage({ message: challenge.body?.message as string });

    const verified = await post(harness, auth, `/wallets/${id}/verify`, {
      challengeId: challenge.body?.challengeId,
      signature,
    });

    expect(verified.status).toBe(200);
    expect(verified.body?.wallet.verified).toBe(true);
  });

  test("the message says plainly that it moves no funds", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { id } = await link(harness, auth);

    const challenge = await post(harness, auth, `/wallets/${id}/challenge`);

    // A wallet prompt showing opaque hex is a prompt people approve unread.
    expect(challenge.body?.message).toContain("moves no funds");
    expect(challenge.body?.message).toContain(harness.merchantId);
  });

  test("a signature from a different key is refused", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { id } = await link(harness, auth);

    const challenge = await post(harness, auth, `/wallets/${id}/challenge`);
    const impostor = privateKeyToAccount(OTHER_KEY);
    const signature = await impostor.signMessage({ message: challenge.body?.message as string });

    const res = await post(harness, auth, `/wallets/${id}/verify`, {
      challengeId: challenge.body?.challengeId,
      signature,
    });
    expect(res.status).toBe(400);
  });

  test("a challenge is consumed, so one signature proves control once", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { id, account } = await link(harness, auth);

    const challenge = await post(harness, auth, `/wallets/${id}/challenge`);
    const signature = await account.signMessage({ message: challenge.body?.message as string });
    const body = { challengeId: challenge.body?.challengeId, signature };

    expect((await post(harness, auth, `/wallets/${id}/verify`, body)).status).toBe(200);
    // Replaying it after an unlink-and-reclaim is exactly what this prevents.
    expect((await post(harness, auth, `/wallets/${id}/verify`, body)).status).toBe(409);
  });

  test("verification without a CSRF token is refused", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { id } = await link(harness, auth);

    const res = await harness.request("POST", `/wallets/${id}/challenge`, { cookies: auth.jar });
    expect(res.status).toBe(403);
  });
});

describe("scoping", () => {
  test("another merchant's wallet is not found", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { id } = await link(harness, auth);

    const other = await harness.container.users.createMerchantAccount({
      email: "other@mayarin.local",
      password: "other-password-12345",
      merchantName: "Other",
      settlementAsset: "USDC",
      acceptedAssets: [],
      permissions: ["settings:manage"],
    });
    expect(other.user.merchantId).not.toBe(harness.merchantId);

    const theirs = await loginAs(harness, "other@mayarin.local", "other-password-12345");
    const res = await post(harness, theirs, `/wallets/${id}/challenge`);

    expect(res.status).toBe(404);
  });

  test("a caller without settings:manage is refused", async () => {
    const harness = await seed();
    const now = harness.clock.now();
    await harness.users.insert({
      id: generateId("usr", now.getTime()),
      email: "reader@mayarin.local",
      passwordHash: "plain:reader-password-1",
      merchantId: harness.merchantId,
      permissions: ["payments:read"],
      createdAt: now,
      updatedAt: now,
    });
    const auth = await loginAs(harness, "reader@mayarin.local", "reader-password-1");

    const res = await harness.request("GET", "/wallets", { cookies: auth.jar });
    expect(res.status).toBe(403);
  });
});

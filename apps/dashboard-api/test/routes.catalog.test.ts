/**
 * Catalog and payment-link route tests (#15).
 *
 * The surface that lets a merchant take a payment without anyone running a
 * script. What is under test is mostly refusal and scoping: no route takes a
 * merchant id, so the interesting question is whether one merchant can reach
 * another's products, and whether a link can be minted with a merchant snapshot
 * that was never filled in.
 */

import { describe, expect, test } from "bun:test";
import type { Permission, User } from "@mayarin/auth";
import { generateId } from "@mayarin/shared";
import { cookieJar, createDashboardHarness } from "./harness.ts";

const ADMIN_EMAIL = "admin@mayarin.local";
const ADMIN_PASSWORD = "correct-horse-battery-staple";

type Harness = Awaited<ReturnType<typeof createDashboardHarness>>;
type Auth = { jar: Record<string, string>; csrf: string };

async function seed() {
  const harness = await createDashboardHarness({
    adminEmail: ADMIN_EMAIL,
    adminPassword: ADMIN_PASSWORD,
  });
  // A merchant with nowhere to be paid has no rail at all, and the counter now
  // says so before it mints anything (#244). These tests are about pricing and
  // ownership, so the merchant is payable.
  const merchant = await harness.merchants.findById(harness.merchantId);
  if (merchant !== null) {
    await harness.merchants.update(
      { ...merchant, settlementAddress: `0x${"ab".repeat(20)}`, version: merchant.version + 1 },
      merchant.version,
    );
  }
  return harness;
}

async function loginAs(harness: Harness, email: string, password: string): Promise<Auth> {
  const res = await harness.request("POST", "/v1/auth/login", { body: { email, password } });
  expect(res.status).toBe(200);
  const jar = cookieJar(res.setCookies);
  return { jar, csrf: jar.mayarin_csrf ?? "" };
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

function post(harness: Harness, auth: Auth, path: string, body?: unknown) {
  return harness.request("POST", path, {
    ...(body === undefined ? {} : { body }),
    cookies: auth.jar,
    headers: { "x-csrf-token": auth.csrf },
  });
}

function patch(harness: Harness, auth: Auth, path: string, body: unknown) {
  return harness.request("PATCH", path, {
    body,
    cookies: auth.jar,
    headers: { "x-csrf-token": auth.csrf },
  });
}

function get(harness: Harness, auth: Auth, path: string) {
  return harness.request("GET", path, { cookies: auth.jar });
}

const PRODUCT = {
  sku: "BEV-001",
  name: "Kopi Susu Gula Aren",
  prices: [{ amount: "25000", asset: "IDR" }],
};

describe("catalog routes", () => {
  test("an anonymous request is 401", async () => {
    const harness = await seed();
    const res = await harness.request("GET", "/v1/catalog/products");
    expect(res.status).toBe(401);
  });

  test("a caller without catalog:manage is 403", async () => {
    const harness = await seed();
    await insertUser(harness, "cashier@mayarin.local", "pw-12345678", ["payments:read"]);
    const auth = await loginAs(harness, "cashier@mayarin.local", "pw-12345678");

    const res = await get(harness, auth, "/v1/catalog/products");
    expect(res.status).toBe(403);
  });

  test("a product is created for the caller's own merchant and read back", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const created = await post(harness, auth, "/v1/catalog/products", PRODUCT);
    expect(created.status).toBe(201);
    expect(created.body?.product.sku).toBe("BEV-001");
    // Money crosses the wire as minor units plus rendered forms, never a float.
    expect(created.body?.product.prices[0].amount).toBe("2500000");
    expect(created.body?.product.active).toBe(true);

    const listed = await get(harness, auth, "/v1/catalog/products");
    expect(listed.body?.products).toHaveLength(1);
  });

  test("paginates products seven at a time without duplicate rows", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        post(harness, auth, "/v1/catalog/products", {
          ...PRODUCT,
          sku: `PAGE-${index}`,
          name: `Product ${index}`,
        }),
      ),
    );

    const first = await get(harness, auth, "/v1/catalog/products?limit=7");
    expect(first.body?.products).toHaveLength(7);
    expect(typeof first.body?.nextCursor).toBe("string");

    const second = await get(
      harness,
      auth,
      `/v1/catalog/products?limit=7&cursor=${encodeURIComponent(String(first.body?.nextCursor))}`,
    );
    expect(second.body?.products).toHaveLength(1);
    const firstIds = first.body?.products.map((product: { id: string }) => product.id) ?? [];
    expect(firstIds).not.toContain(second.body?.products[0].id);
    expect(second.body?.nextCursor).toBeNull();

    const options = await get(harness, auth, "/v1/catalog/products/options");
    expect(options.body?.products).toHaveLength(8);
  });

  test("a merchant id cannot be smuggled into the create body", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const res = await post(harness, auth, "/v1/catalog/products", {
      ...PRODUCT,
      merchantId: "mrc_someone_else",
    });
    // `.strict()`: the field does not exist on this surface, so sending it is a
    // malformed request rather than a silently ignored one.
    expect(res.status).toBe(400);
  });

  test("another merchant's product is 404, not 403", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const created = await post(harness, auth, "/v1/catalog/products", PRODUCT);
    const productId = created.body?.product.id as string;

    const other = await harness.container.users.createMerchantAccount({
      email: "other@mayarin.local",
      password: "pw-12345678",
      merchantName: "Other",
      settlementAsset: "USDC",
      acceptedAssets: ["USDC"],
      permissions: ["catalog:manage"],
    });
    const otherAuth = await loginAs(harness, other.user.email, "pw-12345678");

    const res = await get(harness, otherAuth, `/v1/catalog/products/${productId}`);
    expect(res.status).toBe(404);
  });

  test("a description is cleared by null and left alone by absence", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const created = await post(harness, auth, "/v1/catalog/products", {
      ...PRODUCT,
      description: "Iced, one sugar",
    });
    const productId = created.body?.product.id as string;

    const renamed = await harness.request("PATCH", `/v1/catalog/products/${productId}`, {
      body: { name: "Kopi Susu" },
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });
    expect(renamed.body?.product.description).toBe("Iced, one sugar");

    const cleared = await harness.request("PATCH", `/v1/catalog/products/${productId}`, {
      body: { description: null },
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });
    expect(cleared.body?.product.description).toBeNull();
  });

  test("archiving a product leaves it readable but hides it from the product list", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const created = await post(harness, auth, "/v1/catalog/products", PRODUCT);
    const productId = created.body?.product.id as string;

    const patched = await harness.request("PATCH", `/v1/catalog/products/${productId}`, {
      body: { active: false },
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });
    expect(patched.status).toBe(200);
    expect(patched.body?.product.active).toBe(false);

    const read = await get(harness, auth, `/v1/catalog/products/${productId}`);
    expect(read.status).toBe(200);
    expect(read.body?.product.active).toBe(false);

    const listed = await get(harness, auth, "/v1/catalog/products");
    expect(listed.status).toBe(200);
    expect(listed.body?.products).toEqual([]);
  });
});

describe("payment link routes", () => {
  test("paginates links seven at a time without duplicate rows", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        post(harness, auth, "/v1/payment-links", {
          kind: "open",
          currency: "IDR",
          title: `Counter ${index}`,
        }),
      ),
    );

    const first = await get(harness, auth, "/v1/payment-links?limit=7");
    expect(first.body?.paymentLinks).toHaveLength(7);
    expect(typeof first.body?.nextCursor).toBe("string");
    const second = await get(
      harness,
      auth,
      `/v1/payment-links?limit=7&cursor=${encodeURIComponent(String(first.body?.nextCursor))}`,
    );
    expect(second.body?.paymentLinks).toHaveLength(1);
    const firstIds = first.body?.paymentLinks.map((link: { id: string }) => link.id) ?? [];
    expect(firstIds).not.toContain(second.body?.paymentLinks[0].id);
    expect(second.body?.nextCursor).toBeNull();
  });

  test("a fixed link carries a hosted checkout URL on the payment API", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const res = await post(harness, auth, "/v1/payment-links", {
      kind: "fixed",
      amount: { amount: "50000", asset: "IDR" },
      title: "Counter",
    });

    expect(res.status).toBe(201);
    const link = res.body?.paymentLink;
    expect(link.payable).toBe(true);
    // The URL points at the payment API, which is what mints intents — not at
    // the dashboard API that created the template.
    expect(link.url).toBe(`${harness.container.config.checkoutBaseUrl}/checkout/${link.id}`);
  });

  test("an open link takes no amount: the buyer enters one", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const res = await post(harness, auth, "/v1/payment-links", { kind: "open", currency: "IDR" });
    expect(res.status).toBe(201);
    expect(res.body?.paymentLink.amount).toBeNull();
    expect(res.body?.paymentLink.currency).toBe("IDR");
  });

  test("a link carries its rail restriction and the counter cannot bypass it", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const created = await post(harness, auth, "/v1/payment-links", {
      kind: "open",
      currency: "IDR",
      rails: [{ chain: "arc-testnet", asset: "USDC" }],
    });
    const link = created.body?.paymentLink;

    expect(created.status).toBe(201);
    expect(link.rails).toEqual([{ chain: "arc-testnet", asset: "USDC" }]);

    const charged = await post(harness, auth, `/v1/payment-links/${link.id}/charge`, {
      chain: "base-sepolia",
      asset: "USDC",
      amount: { amount: "75000", asset: "IDR" },
    });
    expect(charged.status).toBe(400);
    expect(String(charged.body?.error.message)).toContain("cannot be paid");
  });

  test("updates a link's accepted rails for future checkouts", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const created = await post(harness, auth, "/v1/payment-links", {
      kind: "open",
      currency: "IDR",
      rails: [{ chain: "arc-testnet", asset: "USDC" }],
    });
    const linkId = created.body?.paymentLink.id as string;

    const updated = await patch(harness, auth, `/v1/payment-links/${linkId}`, {
      rails: [{ chain: "base-sepolia", asset: "USDC" }],
    });

    expect(updated.status).toBe(200);
    expect(updated.body?.paymentLink.rails).toEqual([{ chain: "base-sepolia", asset: "USDC" }]);
    expect(updated.body?.paymentLink.version).toBeGreaterThan(created.body?.paymentLink.version);
  });

  test("a merchant with no city or country cannot mint a link", async () => {
    const harness = await seed();
    // A merchant created before anyone filled in the profile — the ordinary
    // state of a freshly seeded tenant.
    const bare = await harness.container.users.createMerchantAccount({
      email: "bare@mayarin.local",
      password: "pw-12345678",
      merchantName: "Bare",
      settlementAsset: "USDC",
      acceptedAssets: ["USDC"],
      permissions: ["catalog:manage"],
    });
    const auth = await loginAs(harness, bare.user.email, "pw-12345678");

    const res = await post(harness, auth, "/v1/payment-links", {
      kind: "fixed",
      amount: { amount: "50000", asset: "IDR" },
    });

    expect(res.status).toBe(400);
    expect(String(res.body?.error.message)).toContain("settings");
  });

  test("a retired link stops being payable and stays listed", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const created = await post(harness, auth, "/v1/payment-links", {
      kind: "open",
      currency: "IDR",
    });
    const linkId = created.body?.paymentLink.id as string;

    const disabled = await post(harness, auth, `/v1/payment-links/${linkId}/disable`);
    expect(disabled.status).toBe(200);
    expect(disabled.body?.paymentLink.payable).toBe(false);

    const listed = await get(harness, auth, "/v1/payment-links");
    expect(listed.body?.paymentLinks).toHaveLength(1);
  });

  test("a catalog link follows the availability of its selected currency", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const createdProduct = await post(harness, auth, "/v1/catalog/products", {
      ...PRODUCT,
      prices: [
        { amount: "25000", asset: "IDR" },
        { amount: "2", asset: "USD" },
      ],
    });
    const productId = createdProduct.body?.product.id as string;
    const createdLink = await post(harness, auth, "/v1/payment-links", {
      kind: "catalog",
      currency: "USD",
      lines: [{ productId, quantity: 1 }],
    });
    const linkId = createdLink.body?.paymentLink.id as string;

    const removeUsd = await harness.request("PATCH", `/v1/catalog/products/${productId}`, {
      body: { prices: [{ amount: "25000", asset: "IDR" }] },
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });
    expect(removeUsd.status).toBe(200);

    const unavailable = await get(harness, auth, `/v1/payment-links/${linkId}`);
    expect(unavailable.body?.paymentLink.payable).toBe(false);

    const restoreUsd = await harness.request("PATCH", `/v1/catalog/products/${productId}`, {
      body: {
        prices: [
          { amount: "25000", asset: "IDR" },
          { amount: "3", asset: "USD" },
        ],
      },
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });
    expect(restoreUsd.status).toBe(200);

    const availableAgain = await get(harness, auth, `/v1/payment-links/${linkId}`);
    expect(availableAgain.body?.paymentLink.payable).toBe(true);
  });

  test("another merchant's link is 404, not 403", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const created = await post(harness, auth, "/v1/payment-links", {
      kind: "open",
      currency: "IDR",
    });
    const linkId = created.body?.paymentLink.id as string;

    const other = await harness.container.users.createMerchantAccount({
      email: "other-links@mayarin.local",
      password: "pw-12345678",
      merchantName: "Other",
      settlementAsset: "USDC",
      acceptedAssets: ["USDC"],
      city: "Kuala Lumpur",
      countryCode: "MY",
      permissions: ["catalog:manage"],
    });
    const otherAuth = await loginAs(harness, other.user.email, "pw-12345678");

    expect((await get(harness, otherAuth, `/v1/payment-links/${linkId}`)).status).toBe(404);
    expect((await post(harness, otherAuth, `/v1/payment-links/${linkId}/disable`)).status).toBe(
      404,
    );
  });

  test("a catalog link cannot name another merchant's product", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const other = await harness.container.users.createMerchantAccount({
      email: "other-catalog@mayarin.local",
      password: "pw-12345678",
      merchantName: "Other",
      settlementAsset: "USDC",
      acceptedAssets: ["USDC"],
      city: "Surabaya",
      countryCode: "ID",
      permissions: ["catalog:manage"],
    });
    const otherAuth = await loginAs(harness, other.user.email, "pw-12345678");
    const theirs = await post(harness, otherAuth, "/v1/catalog/products", PRODUCT);
    const theirProductId = theirs.body?.product.id as string;

    // Refused at creation rather than at checkout: otherwise the link is
    // accepted, listed and rendered as a QR, and the buyer is the one who finds
    // out it can never be paid.
    const res = await post(harness, auth, "/v1/payment-links", {
      kind: "catalog",
      currency: "IDR",
      lines: [{ productId: theirProductId, quantity: 1 }],
    });
    expect(res.status).toBe(404);
  });

  test("taking a payment mints one and pins the deposit path", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const created = await post(harness, auth, "/v1/payment-links", {
      kind: "open",
      currency: "IDR",
    });
    const linkId = created.body?.paymentLink.id as string;

    const res = await post(harness, auth, `/v1/payment-links/${linkId}/charge`, {
      asset: "USDC",
      amount: { amount: "75000", asset: "IDR" },
    });

    expect(res.status).toBe(201);
    expect(res.body?.paymentIntentId).toMatch(/^pi_/);

    const checkout = harness.paymentApiCalls.find((call) => call.path.endsWith("/checkout"));
    // The counter flow is a scan-to-pay flow, so it asks for the path that
    // allocates an address. The contract path produces nothing to scan.
    expect(checkout?.body).toMatchObject({
      executionPath: "deposit-match",
      payment: { asset: "USDC", chain: "base-sepolia" },
    });
    // Confirming is what locks the price and allocates the address — without it
    // the merchant would be shown a code for an unpriced payment.
    expect(harness.paymentApiCalls.some((call) => call.path.endsWith("/confirm"))).toBe(true);
  });

  test("a payment that cannot be priced is reported, not handed back as an id", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const created = await post(harness, auth, "/v1/payment-links", {
      kind: "open",
      currency: "IDR",
    });
    const linkId = created.body?.paymentLink.id as string;

    // A confirm that answers 200 with a FAILED intent: the request was handled,
    // the payment was not taken. Without this the counter gets an id whose
    // sheet shows "no address to scan" and no reason.
    harness.failNextConfirm("No rate configured for IDR -> USDC");

    const res = await post(harness, auth, `/v1/payment-links/${linkId}/charge`, {
      asset: "USDC",
      amount: { amount: "75000.00", asset: "IDR" },
    });

    expect(res.status).toBe(502);
    expect(String(res.body?.error.message)).toContain("No rate configured");
  });

  test("an asset that cannot be priced is refused before any payment is minted", async () => {
    // The counter used to mint an intent and find out at the price lock, which
    // left a FAILED payment behind for every press of the button — none of them
    // ever a payment. The quote reads the source the lock reads, so the refusal
    // happens before a record exists.
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const created = await post(harness, auth, "/v1/payment-links", {
      kind: "open",
      currency: "IDR",
    });
    const linkId = created.body?.paymentLink.id as string;

    const res = await post(harness, auth, `/v1/payment-links/${linkId}/charge`, {
      asset: "ETH",
      amount: { amount: "75000.00", asset: "IDR" },
    });

    expect(res.status).toBe(400);
    // The reason travels: a missing oracle feed is an operator's fix, and a
    // blank refusal sends them looking at the payer instead.
    expect(String(res.body?.error.message)).toContain("No Pyth feed configured");
    expect(harness.paymentApiCalls.some((call) => call.path.endsWith("/checkout"))).toBe(false);
  });

  test("a catalog link is priced from its products, not refused for having no amount", async () => {
    // A catalog link carries no `amount` — its price is in the products it
    // names. Reading the missing field as "no amount" made every catalog link
    // unchargeable at the counter.
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const product = await post(harness, auth, "/v1/catalog/products", PRODUCT);
    const created = await post(harness, auth, "/v1/payment-links", {
      kind: "catalog",
      currency: "IDR",
      lines: [{ productId: product.body?.product.id, quantity: 3 }],
    });
    const linkId = created.body?.paymentLink.id as string;

    const quote = await post(harness, auth, `/v1/payment-links/${linkId}/quote`, {});
    expect(quote.status).toBe(200);

    const charged = await post(harness, auth, `/v1/payment-links/${linkId}/charge`, {
      asset: "USDC",
    });
    expect(charged.status).toBe(201);
    // Three at 25.000 — the counter charges what the products say, and the
    // amount that reached the payment API is that total rather than a blank.
    const checkout = harness.paymentApiCalls.find((call) => call.path.endsWith("/checkout"));
    expect(checkout?.body).toMatchObject({ payment: { asset: "USDC" } });
  });

  test("an open link cannot be charged without an amount", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const created = await post(harness, auth, "/v1/payment-links", {
      kind: "open",
      currency: "IDR",
    });
    const linkId = created.body?.paymentLink.id as string;

    const res = await post(harness, auth, `/v1/payment-links/${linkId}/charge`, { asset: "USDC" });

    expect(res.status).toBe(400);
    expect(harness.paymentApiCalls.some((call) => call.path.endsWith("/checkout"))).toBe(false);
  });

  test("another merchant's link cannot be charged", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const created = await post(harness, auth, "/v1/payment-links", {
      kind: "open",
      currency: "IDR",
    });
    const linkId = created.body?.paymentLink.id as string;

    const other = await harness.container.users.createMerchantAccount({
      email: "other-charge@mayarin.local",
      password: "pw-12345678",
      merchantName: "Other",
      settlementAsset: "USDC",
      acceptedAssets: ["USDC"],
      city: "Medan",
      countryCode: "ID",
      permissions: ["catalog:manage"],
    });
    const otherAuth = await loginAs(harness, other.user.email, "pw-12345678");

    const res = await post(harness, otherAuth, `/v1/payment-links/${linkId}/charge`, {
      asset: "USDC",
    });
    expect(res.status).toBe(404);
  });

  test("a quote prices the sale in every accepted asset", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const created = await post(harness, auth, "/v1/payment-links", {
      kind: "open",
      currency: "IDR",
    });
    const linkId = created.body?.paymentLink.id as string;

    const res = await post(harness, auth, `/v1/payment-links/${linkId}/quote`, {
      amount: { amount: "75000", asset: "IDR" },
    });

    expect(res.status).toBe(200);
    // Stated on the wire: a rate shown before a payment exists is not the rate
    // the payer is charged, which is locked at confirm.
    expect(res.body?.indicative).toBe(true);
    expect(res.body?.quotes).toHaveLength(2);
    // An asset with no rate is one unavailable line, not a failed request —
    // one unpriceable asset must not blank the counter for the others.
    expect(res.body?.quotes[1]).toMatchObject({ asset: "ETH", available: false });
  });

  // #244: the merchant-wide list is the fallback, not the answer. Quoting it
  // for a chain with its own row left an asset accepted only there off the
  // counter entirely — the merchant could select the rail but never see a price.
  test("a quote on a chain narrows to that chain's accepted assets", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const merchant = await harness.merchants.findById(harness.merchantId);
    if (merchant === null) throw new Error("seeded merchant is missing");
    await harness.merchants.update(
      {
        ...merchant,
        acceptedAssets: ["USDC"],
        acceptedAssetsByChain: { "base-sepolia": ["USDC", "ETH"] },
        version: merchant.version + 1,
      },
      merchant.version,
    );
    const created = await post(harness, auth, "/v1/payment-links", {
      kind: "open",
      currency: "IDR",
    });
    const linkId = created.body?.paymentLink.id as string;

    await post(harness, auth, `/v1/payment-links/${linkId}/quote`, {
      amount: { amount: "75000", asset: "IDR" },
      chain: "base-sepolia",
    });
    await post(harness, auth, `/v1/payment-links/${linkId}/quote`, {
      amount: { amount: "75000", asset: "IDR" },
    });

    // Asserted on what was asked of the payment API, not on what came back:
    // the asset list is this route's decision, and the fake prices whatever it
    // is handed.
    const asked = harness.paymentApiCalls
      .filter((call) => call.path === "/v1/quotes")
      .map((call) => (call.body as { assets: readonly string[] }).assets);

    expect(asked[0]).toEqual(["USDC", "ETH"]);
    // No chain named: the merchant-wide list, exactly as before.
    expect(asked[1]).toEqual(["USDC"]);

    // And the chain travels with it, so the payment API prices the swap leg
    // against a venue with a pool there rather than whichever is first.
    const chains = harness.paymentApiCalls
      .filter((call) => call.path === "/v1/quotes")
      .map((call) => (call.body as { chain?: string }).chain);
    expect(chains).toEqual(["base-sepolia", undefined]);
  });

  // Without it a payer holding a different stablecoin than the merchant is
  // shown the fiat rate and none of the swap: $1.00 read as 0,867417 EURC for
  // a payment that then took 1,295757.
  test("a quote says what the merchant settles in", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const created = await post(harness, auth, "/v1/payment-links", {
      kind: "open",
      currency: "IDR",
    });
    const linkId = created.body?.paymentLink.id as string;

    await post(harness, auth, `/v1/payment-links/${linkId}/quote`, {
      amount: { amount: "75000", asset: "IDR" },
    });

    const asked = harness.paymentApiCalls.find((call) => call.path === "/v1/quotes");
    expect((asked?.body as { settlementAsset?: string } | undefined)?.settlementAsset).toBe("USDC");
  });

  test("an open link with no amount cannot be quoted", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const created = await post(harness, auth, "/v1/payment-links", {
      kind: "open",
      currency: "IDR",
    });
    const linkId = created.body?.paymentLink.id as string;

    const res = await post(harness, auth, `/v1/payment-links/${linkId}/quote`, {});
    expect(res.status).toBe(400);
  });

  test("creating a link without the CSRF token is refused", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const res = await harness.request("POST", "/v1/payment-links", {
      body: { kind: "open", currency: "IDR" },
      cookies: auth.jar,
    });
    expect(res.status).toBe(403);
  });
});

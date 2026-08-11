/**
 * Orders route tests — the derived commerce view of payments.
 *
 * An order is a payment intent that carries a cart snapshot or a merchant
 * reference; a plain transfer is not one. The view assembles line items from
 * the frozen snapshot and the customer from `metadata.customerId`, both of
 * which the payment API already persists, so this is a read test: the right
 * intents surface, the wrong merchant's do not, and a referenced payment with
 * no cart renders as one synthetic line.
 */

import { describe, expect, test } from "bun:test";
import { cartSnapshot, priceCart } from "@mayarin/catalog";
import { confirm, markCompleted, markProcessing } from "@mayarin/payment-intent";
import { money } from "@mayarin/shared";
import { cookieJar, createDashboardHarness } from "./harness.ts";

const ADMIN_EMAIL = "admin@mayarin.local";
const ADMIN_PASSWORD = "correct-horse-battery-staple";

type Harness = Awaited<ReturnType<typeof createDashboardHarness>>;

async function seed() {
  const harness = await createDashboardHarness({
    adminEmail: ADMIN_EMAIL,
    adminPassword: ADMIN_PASSWORD,
  });
  const auth = await login(harness);
  return { harness, auth };
}

async function login(harness: Harness) {
  const res = await harness.request("POST", "/auth/login", {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.status).toBe(200);
  const jar = cookieJar(res.setCookies);
  return { jar, csrf: jar.mayarin_csrf ?? "" };
}

const MERCHANT = { name: "Acme", city: "Jakarta", countryCode: "ID" } as const;

async function createIntent(
  harness: Harness,
  overrides: {
    readonly cart?: string;
    readonly merchantReference?: string;
    readonly customerId?: string;
    readonly amount?: ReturnType<typeof money>;
  },
) {
  const intent = await harness.intentService.create({
    merchant: { id: harness.merchantId, ...MERCHANT },
    amount: overrides.amount ?? money(50_000n, "IDR"),
    source: { type: "manual" },
    metadata: {
      ...(overrides.cart === undefined ? {} : { cart: overrides.cart }),
      ...(overrides.customerId === undefined ? {} : { customerId: overrides.customerId }),
    },
    ...(overrides.merchantReference === undefined
      ? {}
      : { merchantReference: overrides.merchantReference }),
  });
  return intent;
}

/** Drives an intent through CREATED → CONFIRMED → PROCESSING → COMPLETED. */
async function complete(harness: Harness, intentId: string) {
  const now = harness.clock.now();
  const found = await harness.intents.findById(intentId);
  if (found === null) throw new Error(`intent ${intentId} not found`);
  const confirmed = confirm(found, now);
  await harness.intents.update(confirmed, found.version);
  const processing = markProcessing(confirmed, "ctx_1", now);
  await harness.intents.update(processing, confirmed.version);
  const completed = markCompleted(processing, now);
  await harness.intents.update(completed, processing.version);
  return completed;
}

describe("GET /orders", () => {
  test("lists intents that carry a cart snapshot or a merchant reference", async () => {
    const { harness, auth } = await seed();

    const cart = cartSnapshot(
      priceCart(
        [
          { name: "Kopi Susu", unitPrice: money(25_000n, "IDR"), quantity: 2 },
          { name: "Croissant", unitPrice: money(20_000n, "IDR"), quantity: 1 },
        ],
        "IDR",
      ),
    );
    await createIntent(harness, { cart });
    await createIntent(harness, { merchantReference: "INV-0099" });
    // A plain transfer with neither is not an order.
    await createIntent(harness, {});

    const res = await harness.request("GET", "/orders", { cookies: auth.jar });
    expect(res.status).toBe(200);
    const orders = res.body?.orders ?? [];
    expect(orders).toHaveLength(2);

    const cartOrder = orders.find(
      (o: { merchantReference: string | null }) => o.merchantReference === null,
    );
    expect(cartOrder.lines).toHaveLength(2);
    expect(cartOrder.lines[0].name).toBe("Kopi Susu");
    expect(cartOrder.lines[0].quantity).toBe(2);
    expect(cartOrder.status).toBe("CREATED");
  });

  test("a referenced intent without a cart renders one synthetic 'Payment' line", async () => {
    const { harness, auth } = await seed();
    await createIntent(harness, { merchantReference: "INV-0001" });

    const res = await harness.request("GET", "/orders", { cookies: auth.jar });
    const order = res.body?.orders[0];
    expect(order.merchantReference).toBe("INV-0001");
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0].name).toBe("Payment");
    expect(order.lines[0].quantity).toBe(1);
  });

  test("requires authentication", async () => {
    const { harness } = await seed();
    const res = await harness.request("GET", "/orders");
    expect(res.status).toBe(401);
  });

  test("a foreign customer id returns 404, not the other merchant's orders", async () => {
    const { harness, auth } = await seed();
    const res = await harness.request("GET", "/orders?customerId=cus_foreign", {
      cookies: auth.jar,
    });
    expect(res.status).toBe(404);
  });

  test("filters and paginates referenced orders with opaque cursors", async () => {
    const { harness, auth } = await seed();
    await createIntent(harness, { merchantReference: "KEEP-001" });
    await createIntent(harness, { merchantReference: "KEEP-002" });
    await createIntent(harness, { merchantReference: "DROP-001" });

    const first = await harness.request("GET", "/orders?q=KEEP&limit=1", { cookies: auth.jar });
    expect(first.body?.orders).toHaveLength(1);
    expect(typeof first.body?.nextCursor).toBe("string");

    const second = await harness.request(
      "GET",
      `/orders?q=KEEP&limit=1&cursor=${encodeURIComponent(String(first.body?.nextCursor))}`,
      { cookies: auth.jar },
    );
    expect(second.body?.orders).toHaveLength(1);
    expect(second.body?.orders[0].id).not.toBe(first.body?.orders[0].id);
  });
});

describe("GET /orders?customerId=", () => {
  test("returns only the orders stamped with that customer", async () => {
    const { harness, auth } = await seed();

    // Seed a customer through the directory.
    const created = await harness.request("POST", "/customers", {
      body: { name: "Budi" },
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });
    const customerId = created.body?.customer.id;
    expect(customerId).toMatch(/^cus_/);

    await createIntent(harness, {
      cart: cartSnapshot(
        priceCart([{ name: "Kopi", unitPrice: money(10_000n, "IDR"), quantity: 1 }], "IDR"),
      ),
      customerId,
    });
    await createIntent(harness, { merchantReference: "INV-2" });

    const res = await harness.request("GET", `/orders?customerId=${customerId}`, {
      cookies: auth.jar,
    });
    expect(res.status).toBe(200);
    const orders = res.body?.orders ?? [];
    expect(orders).toHaveLength(1);
    expect(orders[0].customer.id).toBe(customerId);
    expect(orders[0].customer.name).toBe("Budi");
  });
});

describe("customer detail lifetime value", () => {
  test("sums completed orders in the first completed order's currency", async () => {
    const { harness, auth } = await seed();
    const created = await harness.request("POST", "/customers", {
      body: { name: "Sari" },
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });
    const customerId = created.body?.customer.id;

    const a = await createIntent(harness, {
      amount: money(10_000n, "IDR"),
      cart: cartSnapshot(
        priceCart([{ name: "Kopi", unitPrice: money(10_000n, "IDR"), quantity: 1 }], "IDR"),
      ),
      customerId,
    });
    await complete(harness, a.id);
    const b = await createIntent(harness, {
      amount: money(10_000n, "IDR"),
      cart: cartSnapshot(
        priceCart([{ name: "Teh", unitPrice: money(5_000n, "IDR"), quantity: 2 }], "IDR"),
      ),
      customerId,
    });
    await complete(harness, b.id);

    const res = await harness.request("GET", `/customers/${customerId}`, { cookies: auth.jar });
    expect(res.status).toBe(200);
    expect(res.body?.lifetimeValue.amount).toBe("20000");
    expect(res.body?.lifetimeValue.asset).toBe("IDR");
    expect(res.body?.orders).toHaveLength(2);
  });

  test("is null when the customer has no completed orders", async () => {
    const { harness, auth } = await seed();
    const created = await harness.request("POST", "/customers", {
      body: { name: "Walk-in" },
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });
    const customerId = created.body?.customer.id;

    const res = await harness.request("GET", `/customers/${customerId}`, { cookies: auth.jar });
    expect(res.body?.lifetimeValue).toBeNull();
  });
});

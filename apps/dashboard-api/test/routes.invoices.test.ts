import { describe, expect, test } from "bun:test";
import type { Permission, User } from "@mayarin/auth";
import { generateId } from "@mayarin/shared";
import { cookieJar, createDashboardHarness } from "./harness.ts";

const ADMIN_EMAIL = "admin@mayarin.local";
const ADMIN_PASSWORD = "correct-horse-battery-staple";

type Harness = Awaited<ReturnType<typeof createDashboardHarness>>;
type Auth = { readonly jar: Record<string, string>; readonly csrf: string };

async function seed() {
  return createDashboardHarness({ adminEmail: ADMIN_EMAIL, adminPassword: ADMIN_PASSWORD });
}

async function login(
  harness: Harness,
  email = ADMIN_EMAIL,
  password = ADMIN_PASSWORD,
): Promise<Auth> {
  const response = await harness.request("POST", "/v1/auth/login", {
    body: { email, password },
  });
  expect(response.status).toBe(200);
  const jar = cookieJar(response.setCookies);
  return { jar, csrf: jar.mayarin_csrf ?? "" };
}

function post(harness: Harness, auth: Auth, path: string, body?: unknown) {
  return harness.request("POST", path, {
    ...(body === undefined ? {} : { body }),
    cookies: auth.jar,
    headers: { "x-csrf-token": auth.csrf },
  });
}

const INVOICE = {
  buyer: {
    name: "PT Buyer Indonesia",
    email: "accounts@buyer.example",
    address: "Jl. Jenderal Sudirman 1, Jakarta",
  },
  currency: "IDR",
  lines: [
    { name: "Implementation service", unitPrice: { amount: "125000", asset: "IDR" }, quantity: 2 },
  ],
  notes: "Thank you for your business.",
  dueAt: "2026-01-31T23:59:59.999Z",
};

describe("dashboard invoice routes", () => {
  test("requires authentication and catalog management permission", async () => {
    const harness = await seed();
    expect((await harness.request("GET", "/v1/invoices")).status).toBe(401);

    const now = harness.clock.now();
    const user: User = {
      id: generateId("usr", now.getTime()),
      email: "viewer@mayarin.local",
      passwordHash: "plain:viewer-password",
      merchantId: harness.merchantId,
      permissions: ["payments:read"] satisfies readonly Permission[],
      emailVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await harness.users.insert(user);
    const auth = await login(harness, user.email, "viewer-password");
    expect((await harness.request("GET", "/v1/invoices", { cookies: auth.jar })).status).toBe(403);
  });

  test("generates an issued invoice with a client payment URL", async () => {
    const harness = await seed();
    const auth = await login(harness);

    const created = await post(harness, auth, "/v1/invoices", INVOICE);
    expect(created.status).toBe(201);
    expect(created.body?.invoice.state).toBe("issued");
    expect(created.body?.invoice.status).toBe("issued");
    expect(created.body?.invoice.number).toBe("INV/2026/0001");
    expect(created.body?.invoice.total.amount).toBe("25000000");
    expect(created.body?.invoice.outstanding.amount).toBe("25000000");
    expect(created.body?.invoice.url).toBe(
      `${harness.container.config.checkoutBaseUrl}/invoices/${created.body?.invoice.id}/view`,
    );

    const listed = await harness.request("GET", "/v1/invoices", { cookies: auth.jar });
    expect(listed.status).toBe(200);
    expect(listed.body?.invoices).toHaveLength(1);
    expect(listed.body?.invoices[0].buyer.email).toBe("accounts@buyer.example");
  });

  test("emails an owned issued invoice to its snapshotted client", async () => {
    const harness = await seed();
    const auth = await login(harness);
    const created = await post(harness, auth, "/v1/invoices", INVOICE);
    const id = String(created.body?.invoice.id);

    const sent = await post(harness, auth, `/v1/invoices/${encodeURIComponent(id)}/send`, {
      deliveryId: "00000000-0000-4000-8000-000000000001",
    });

    expect(sent.status).toBe(200);
    expect(sent.body?.delivery).toEqual({
      id: "eml_test_invoice",
      recipient: "accounts@buyer.example",
    });
    expect(harness.invoiceEmailCalls).toHaveLength(1);
    expect(harness.invoiceEmailCalls[0]).toMatchObject({
      invoiceId: id,
      deliveryId: "00000000-0000-4000-8000-000000000001",
      invoiceNumber: "INV/2026/0001",
      merchantName: "Acme",
      buyerName: "PT Buyer Indonesia",
      buyerEmail: "accounts@buyer.example",
      total: "Rp 250.000,00",
      outstanding: "Rp 250.000,00",
      url: `${harness.container.config.checkoutBaseUrl}/invoices/${id}/view`,
    });

    const resent = await post(harness, auth, `/v1/invoices/${encodeURIComponent(id)}/send`, {
      deliveryId: "00000000-0000-4000-8000-000000000002",
    });
    expect(resent.status).toBe(200);
    expect(harness.invoiceEmailCalls).toHaveLength(2);
    expect(harness.invoiceEmailCalls[1]?.deliveryId).toBe("00000000-0000-4000-8000-000000000002");
  });

  test("refuses email delivery when the invoice has no client email", async () => {
    const harness = await seed();
    const auth = await login(harness);
    const created = await post(harness, auth, "/v1/invoices", {
      ...INVOICE,
      buyer: { name: INVOICE.buyer.name },
    });
    const id = String(created.body?.invoice.id);

    const sent = await post(harness, auth, `/v1/invoices/${encodeURIComponent(id)}/send`, {
      deliveryId: "00000000-0000-4000-8000-000000000001",
    });

    expect(sent.status).toBe(400);
    expect(sent.body?.error.message).toBe("This invoice has no client email address");
    expect(harness.invoiceEmailCalls).toHaveLength(0);
  });

  test("does not accept a forged merchant identity", async () => {
    const harness = await seed();
    const auth = await login(harness);
    const response = await post(harness, auth, "/v1/invoices", {
      ...INVOICE,
      merchantId: "mrc_someone_else",
    });
    expect(response.status).toBe(400);
  });

  test("voids an issued invoice so the client can no longer pay it", async () => {
    const harness = await seed();
    const auth = await login(harness);
    const created = await post(harness, auth, "/v1/invoices", INVOICE);
    const id = String(created.body?.invoice.id);

    const voided = await post(harness, auth, `/v1/invoices/${encodeURIComponent(id)}/void`);
    expect(voided.status).toBe(200);
    expect(voided.body?.invoice.state).toBe("void");
    expect(voided.body?.invoice.status).toBe("void");
    expect(voided.body?.invoice.number).toBe("INV/2026/0001");
  });

  test("another merchant receives 404 for an invoice they do not own", async () => {
    const harness = await seed();
    const auth = await login(harness);
    const created = await post(harness, auth, "/v1/invoices", INVOICE);

    const other = await harness.container.users.createMerchantAccount({
      email: "other@mayarin.local",
      password: "other-password",
      merchantName: "Other Merchant",
      settlementAsset: "USDC",
      acceptedAssets: ["USDC"],
      city: "Bandung",
      countryCode: "ID",
      permissions: ["catalog:manage"],
    });
    const otherAuth = await login(harness, other.user.email, "other-password");
    const response = await harness.request(
      "GET",
      `/v1/invoices/${encodeURIComponent(String(created.body?.invoice.id))}`,
      { cookies: otherAuth.jar },
    );
    expect(response.status).toBe(404);
  });
});

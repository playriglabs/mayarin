/**
 * Customer route tests — the merchant-managed directory.
 *
 * The merchant is always the one on the session; a customer belonging to
 * another merchant resolves to the same 404 an absent id would, so a foreign
 * id is not a leak. Mutating routes require a CSRF token; reads do not.
 */

import { describe, expect, test } from "bun:test";
import { createCustomer } from "@mayarin/catalog";
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

async function createCustomerApi(
  harness: Harness,
  auth: { jar: Record<string, string>; csrf: string },
  body: unknown,
) {
  return harness.request("POST", "/customers", {
    body,
    cookies: auth.jar,
    headers: { "x-csrf-token": auth.csrf },
  });
}

describe("GET /customers", () => {
  test("lists the merchant's own customers", async () => {
    const { harness, auth } = await seed();
    await createCustomerApi(harness, auth, { name: "Budi", email: "budi@example.com" });
    await createCustomerApi(harness, auth, { name: "Sari" });

    const res = await harness.request("GET", "/customers", { cookies: auth.jar });
    expect(res.status).toBe(200);
    expect(res.body?.customers).toHaveLength(2);
    expect(res.body?.customers.map((c: { name: string }) => c.name).sort()).toEqual([
      "Budi",
      "Sari",
    ]);
  });

  test("requires authentication", async () => {
    const { harness } = await seed();
    const res = await harness.request("GET", "/customers");
    expect(res.status).toBe(401);
  });
});

describe("POST /customers", () => {
  test("creates one and returns 201", async () => {
    const { harness, auth } = await seed();
    const res = await createCustomerApi(harness, auth, {
      name: "Budi",
      email: "budi@example.com",
      notes: "Regular",
    });
    expect(res.status).toBe(201);
    expect(res.body?.customer.id).toMatch(/^cus_/);
    expect(res.body?.customer.email).toBe("budi@example.com");
  });

  test("without a CSRF token is refused", async () => {
    const { harness, auth } = await seed();
    const res = await harness.request("POST", "/customers", {
      body: { name: "Budi" },
      cookies: auth.jar,
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /customers/:id", () => {
  test("returns the customer with their linked orders", async () => {
    const { harness, auth } = await seed();
    const created = await createCustomerApi(harness, auth, { name: "Budi" });
    const id = created.body?.customer.id;

    const res = await harness.request("GET", `/customers/${id}`, { cookies: auth.jar });
    expect(res.status).toBe(200);
    expect(res.body?.customer.id).toBe(id);
    expect(res.body?.orders).toEqual([]);
    expect(res.body?.lifetimeValue).toBeNull();
  });

  test("a foreign merchant's customer is 404", async () => {
    const { harness, auth } = await seed();
    // Insert a customer under a different merchant, bypassing the scope check.
    const foreign = createCustomer({
      merchantId: "mrc_other",
      name: "Not yours",
      now: harness.clock.now(),
    });
    await harness.customerRepository.insert(foreign);

    const res = await harness.request("GET", `/customers/${foreign.id}`, { cookies: auth.jar });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /customers/:id", () => {
  test("updates the name and bumps the version", async () => {
    const { harness, auth } = await seed();
    const created = await createCustomerApi(harness, auth, { name: "Budi" });
    const id = created.body?.customer.id;

    const res = await harness.request("PATCH", `/customers/${id}`, {
      body: { name: "Budi Hartono" },
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });
    expect(res.status).toBe(200);
    expect(res.body?.customer.name).toBe("Budi Hartono");
    expect(res.body?.customer.version).toBe(2);
  });

  test("email: null clears it", async () => {
    const { harness, auth } = await seed();
    const created = await createCustomerApi(harness, auth, {
      name: "Budi",
      email: "budi@example.com",
    });
    const id = created.body?.customer.id;

    const res = await harness.request("PATCH", `/customers/${id}`, {
      body: { email: null },
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });
    expect(res.body?.customer.email).toBeNull();
  });

  test("without a CSRF token is refused", async () => {
    const { harness, auth } = await seed();
    const created = await createCustomerApi(harness, auth, { name: "Budi" });
    const res = await harness.request("PATCH", `/customers/${created.body?.customer.id}`, {
      body: { name: "X" },
      cookies: auth.jar,
    });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /customers/:id", () => {
  test("deletes the customer and returns 204", async () => {
    const { harness, auth } = await seed();
    const created = await createCustomerApi(harness, auth, { name: "Budi" });
    const id = created.body?.customer.id;

    const res = await harness.request("DELETE", `/customers/${id}`, {
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });
    expect(res.status).toBe(204);

    const after = await harness.request("GET", `/customers/${id}`, { cookies: auth.jar });
    expect(after.status).toBe(404);
  });

  test("deleting a foreign customer is 404", async () => {
    const { harness, auth } = await seed();
    const foreign = createCustomer({
      merchantId: "mrc_other",
      name: "Not yours",
      now: harness.clock.now(),
    });
    await harness.customerRepository.insert(foreign);

    const res = await harness.request("DELETE", `/customers/${foreign.id}`, {
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });
    expect(res.status).toBe(404);
  });
});

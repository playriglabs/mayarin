/**
 * Audit route tests — the compliance query interface (#16).
 *
 * The two properties worth holding at the HTTP edge: the merchant scope comes
 * from the session and cannot be overridden by a caller, and the record carries
 * every source that recorded the payment. Cross-merchant reads resolve to the
 * same 404 an absent id does, exactly as `/v1/payments` already does.
 */

import { describe, expect, test } from "bun:test";
import type { Permission, User } from "@mayarin/auth";
import type { ClearingTransaction } from "@mayarin/clearing";
import { assetReceivedPosting } from "@mayarin/clearing";
import { generateId, money } from "@mayarin/shared";
import { cookieJar, createDashboardHarness } from "./harness.ts";

type Harness = Awaited<ReturnType<typeof createDashboardHarness>>;

function transaction(merchantId: string, id: string, createdAt: Date): ClearingTransaction {
  return {
    id,
    paymentIntentId: `pint_${id}`,
    state: "SUCCESS",
    merchant: { id: merchantId, name: "Warung", city: "Jakarta", countryCode: "ID" },
    sourceAmount: money(5_000_000n, "IDR"),
    settlementAsset: "USDC",
    provider: "mock",
    settlementAmount: money(3_000_000n, "USDC"),
    fee: money(10_000n, "USDC"),
    netAmount: money(2_990_000n, "USDC"),
    createdAt,
    updatedAt: createdAt,
    version: 4,
  };
}

async function seed() {
  const harness = await createDashboardHarness();
  const now = harness.clock.now();

  await makeUser(harness, now, "mch_a", "warung-a@mayarin.local", "pw-a");
  await makeUser(harness, now, "mch_b", "warung-b@mayarin.local", "pw-b");

  const paymentA = transaction("mch_a", "clr_a", new Date("2026-01-15T00:00:00.000Z"));
  const paymentB = transaction("mch_b", "clr_b", new Date("2026-01-16T00:00:00.000Z"));

  await harness.clearing.insert(paymentA, []);
  await harness.clearing.insert(paymentB, []);
  harness.audits.add(paymentA, paymentB);
  await harness.ledgerService.post(assetReceivedPosting(paymentA));

  return { harness, paymentA, paymentB };
}

async function makeUser(
  harness: Harness,
  now: Date,
  merchantId: string,
  email: string,
  password: string,
  permissions: readonly Permission[] = ["payments:read"],
): Promise<User> {
  const user: User = {
    id: generateId("usr", now.getTime()),
    email,
    passwordHash: `plain:${password}`,
    merchantId,
    permissions: [...permissions],
    emailVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await harness.users.insert(user);
  return user;
}

async function loginAs(
  harness: Harness,
  email: string,
  password: string,
): Promise<Record<string, string>> {
  const res = await harness.request("POST", "/v1/auth/login", { body: { email, password } });
  expect(res.status).toBe(200);
  return cookieJar(res.setCookies);
}

describe("audit routes", () => {
  test("an anonymous request to /audit is 401", async () => {
    const { harness } = await seed();
    const res = await harness.request("GET", "/v1/audit");
    expect(res.status).toBe(401);
  });

  test("a merchant sees only their own payments", async () => {
    const { harness } = await seed();
    const jar = await loginAs(harness, "warung-a@mayarin.local", "pw-a");
    const res = await harness.request("GET", "/v1/audit", { cookies: jar });

    expect(res.status).toBe(200);
    const ids = ((res.body?.payments ?? []) as Array<{ clearingTransactionId: string }>).map(
      (row) => row.clearingTransactionId,
    );
    expect(ids).toEqual(["clr_a"]);
  });

  test("a merchantId in the query string cannot widen the scope", async () => {
    const { harness } = await seed();
    const jar = await loginAs(harness, "warung-a@mayarin.local", "pw-a");
    // The scope is taken from the session; an unknown query param is ignored.
    const res = await harness.request("GET", "/v1/audit?merchantId=mch_b", { cookies: jar });

    expect(res.status).toBe(200);
    const ids = ((res.body?.payments ?? []) as Array<{ clearingTransactionId: string }>).map(
      (row) => row.clearingTransactionId,
    );
    expect(ids).toEqual(["clr_a"]);
  });

  test("an unsupported asset is a 400, not an empty list", async () => {
    const { harness } = await seed();
    const jar = await loginAs(harness, "warung-a@mayarin.local", "pw-a");
    const res = await harness.request("GET", "/v1/audit?asset=NOTACOIN", { cookies: jar });
    expect(res.status).toBe(400);
  });

  test("the record carries the ledger postings and a reconciliation verdict", async () => {
    const { harness } = await seed();
    const jar = await loginAs(harness, "warung-a@mayarin.local", "pw-a");
    const res = await harness.request("GET", "/v1/audit/clr_a", { cookies: jar });

    expect(res.status).toBe(200);
    expect(res.body?.clearing?.id).toBe("clr_a");
    expect(res.body?.postings).toHaveLength(1);
    // Money crosses the wire as an exact minor-unit string, never a number.
    expect(res.body?.postings?.[0]?.entries?.[0]?.amount?.amount).toBe("3000000");
    // No confirmed PaymentCompleted log: nobody checked, and it says so.
    expect(res.body?.reconciliation?.status).toBe("NO_ON_CHAIN_RECORD");
  });

  test("a cross-merchant audit record is 404, not 403", async () => {
    const { harness } = await seed();
    const jar = await loginAs(harness, "warung-a@mayarin.local", "pw-a");
    const res = await harness.request("GET", "/v1/audit/clr_b", { cookies: jar });
    expect(res.status).toBe(404);
  });
});

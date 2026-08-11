/**
 * Settlement route tests (#15).
 *
 * The payout view: what clearing booked, plus what the chain reported when
 * there is a contract path behind it. Two properties matter at the edge — the
 * merchant scope comes from the session and cannot be widened, and a payment
 * with no clearing transaction is absent rather than shown with blank amounts,
 * because a row of dashes in a money table reads as a failure.
 */

import { describe, expect, test } from "bun:test";
import type { Permission, User } from "@mayarin/auth";
import type { ClearingTransaction } from "@mayarin/clearing";
import { generateId, money } from "@mayarin/shared";
import { cookieJar, createDashboardHarness } from "./harness.ts";

type Harness = Awaited<ReturnType<typeof createDashboardHarness>>;

/** The on-chain id the backend signs into the order; the log names it back. */
const CONTRACT_INTENT_ID = `0x${"ab".repeat(32)}`;

function transaction(
  merchantId: string,
  id: string,
  paymentIntentId: string,
  createdAt: Date,
  contract = false,
): ClearingTransaction {
  return {
    id,
    paymentIntentId,
    state: "SUCCESS",
    merchant: { id: merchantId, name: "Warung", city: "Jakarta", countryCode: "ID" },
    sourceAmount: money(5_000_000n, "IDR"),
    settlementAsset: "USDC",
    provider: "mock",
    settlementAmount: money(3_000_000n, "USDC"),
    fee: money(10_000n, "USDC"),
    netAmount: money(2_990_000n, "USDC"),
    ...(contract
      ? {
          contract: {
            order: {
              intentId: CONTRACT_INTENT_ID,
              settlementToken: `0x${"cd".repeat(20)}`,
              minOut: 3_000_000n,
              fee: 10_000n,
              merchantSafe: `0x${"11".repeat(20)}`,
              refundTo: `0x${"22".repeat(20)}`,
              deadline: 1_800_000_000n,
              signature: "0xsig",
              signer: `0x${"33".repeat(20)}`,
            },
            payerEstimate: money(3_100_000n, "USDC"),
            expiresAt: new Date("2026-02-01T00:00:00.000Z"),
            txHash: `0x${"ee".repeat(32)}`,
          },
        }
      : {}),
    createdAt,
    updatedAt: createdAt,
    version: 6,
  };
}

async function makeUser(
  harness: Harness,
  merchantId: string,
  email: string,
  password: string,
  permissions: readonly Permission[] = ["payments:read"],
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
  return cookieJar(res.setCookies);
}

async function seed() {
  const harness = await createDashboardHarness();
  await makeUser(harness, "mch_a", "warung-a@mayarin.local", "pw-a");
  await makeUser(harness, "mch_b", "warung-b@mayarin.local", "pw-b");

  const intentA = await harness.intentService.create({
    merchant: { id: "mch_a", name: "Warung A", city: "Jakarta", countryCode: "ID" },
    amount: { amount: 50_000n, asset: "IDR" },
    source: { type: "manual" },
  });
  const intentB = await harness.intentService.create({
    merchant: { id: "mch_b", name: "Warung B", city: "Bandung", countryCode: "ID" },
    amount: { amount: 75_000n, asset: "IDR" },
    source: { type: "manual" },
  });

  return { harness, intentA, intentB };
}

describe("GET /settlements", () => {
  test("an anonymous request is 401", async () => {
    const { harness } = await seed();
    expect((await harness.request("GET", "/settlements")).status).toBe(401);
  });

  test("returns what clearing booked for the caller's own payments", async () => {
    const { harness, intentA } = await seed();
    await harness.clearing.insert(
      transaction("mch_a", "clr_a", intentA.id, new Date("2026-01-15T00:00:00.000Z")),
      [],
    );
    const jar = await loginAs(harness, "warung-a@mayarin.local", "pw-a");

    const res = await harness.request("GET", "/settlements", { cookies: jar });
    expect(res.status).toBe(200);
    expect(res.body?.settlements).toHaveLength(1);

    const row = res.body?.settlements[0];
    expect(row.paymentIntentId).toBe(intentA.id);
    // The three amounts are distinct and none is derived from another on the
    // wire: the gross, the fee, and what the merchant actually receives.
    expect(row.settlementAmount.amount).toBe("3000000");
    expect(row.fee.amount).toBe("10000");
    expect(row.netAmount.amount).toBe("2990000");
  });

  test("summary covers every settlement when the table page is limited to seven", async () => {
    const { harness } = await seed();
    const intents = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        harness.intentService.create({
          merchant: { id: "mch_a", name: "Warung A", city: "Jakarta", countryCode: "ID" },
          amount: { amount: BigInt(50_000 + index), asset: "IDR" },
          source: { type: "manual" },
        }),
      ),
    );
    await Promise.all(
      intents.map((intent, index) =>
        harness.clearing.insert(
          transaction(
            "mch_a",
            `clr_summary_${index}`,
            intent.id,
            new Date(`2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`),
          ),
          [],
        ),
      ),
    );
    const jar = await loginAs(harness, "warung-a@mayarin.local", "pw-a");

    const res = await harness.request("GET", "/settlements", { cookies: jar });

    expect(res.body?.settlements).toHaveLength(7);
    expect(res.body?.summary).toMatchObject({
      settledCount: 8,
      inFlightCount: 0,
      failedCount: 0,
      asset: "USDC",
    });
    expect(res.body?.summary.netAmount.amount).toBe("23920000");
    expect(res.body?.summary.fee.amount).toBe("80000");
    expect(typeof res.body?.nextCursor).toBe("string");

    const next = await harness.request(
      "GET",
      `/settlements?cursor=${encodeURIComponent(String(res.body?.nextCursor))}`,
      { cookies: jar },
    );
    const firstIds = res.body?.settlements.map(
      (row: { paymentIntentId: string }) => row.paymentIntentId,
    );
    const nextIds = next.body?.settlements.map(
      (row: { paymentIntentId: string }) => row.paymentIntentId,
    );
    expect(nextIds.some((id: string) => firstIds.includes(id))).toBe(false);
    expect(next.body?.summary).toEqual(res.body?.summary);
  });

  test("another merchant's settlements are never listed", async () => {
    const { harness, intentA, intentB } = await seed();
    await harness.clearing.insert(
      transaction("mch_a", "clr_a", intentA.id, new Date("2026-01-15T00:00:00.000Z")),
      [],
    );
    await harness.clearing.insert(
      transaction("mch_b", "clr_b", intentB.id, new Date("2026-01-16T00:00:00.000Z")),
      [],
    );
    const jar = await loginAs(harness, "warung-a@mayarin.local", "pw-a");

    const res = await harness.request("GET", "/settlements", { cookies: jar });
    expect(res.body?.settlements).toHaveLength(1);
    expect(res.body?.settlements[0].paymentIntentId).toBe(intentA.id);
  });

  test("a merchantId in the query string cannot widen the scope", async () => {
    const { harness, intentB } = await seed();
    await harness.clearing.insert(
      transaction("mch_b", "clr_b", intentB.id, new Date("2026-01-16T00:00:00.000Z")),
      [],
    );
    const jar = await loginAs(harness, "warung-a@mayarin.local", "pw-a");

    const res = await harness.request("GET", "/settlements?merchantId=mch_b", { cookies: jar });
    expect(res.body?.settlements).toHaveLength(0);
  });

  test("a payment with no clearing transaction is absent, not a blank row", async () => {
    const { harness } = await seed();
    const jar = await loginAs(harness, "warung-a@mayarin.local", "pw-a");

    const res = await harness.request("GET", "/settlements", { cookies: jar });
    expect(res.body?.settlements).toHaveLength(0);
  });

  test("the chain's own record is reported alongside the booked amounts", async () => {
    const { harness, intentA } = await seed();
    await harness.clearing.insert(
      transaction("mch_a", "clr_a", intentA.id, new Date("2026-01-15T00:00:00.000Z"), true),
      [],
    );
    await harness.settlements.record(
      [
        {
          chain: "base-sepolia",
          txHash: `0x${"ee".repeat(32)}`,
          logIndex: 0,
          blockNumber: 42n,
          blockHash: `0x${"ff".repeat(32)}`,
          intentId: CONTRACT_INTENT_ID,
          merchantSafe: `0x${"11".repeat(20)}`,
          settledAmount: 2_990_000n,
          fee: 10_000n,
          refundAmount: 0n,
        },
      ],
      harness.clock.now(),
    );

    const jar = await loginAs(harness, "warung-a@mayarin.local", "pw-a");
    const res = await harness.request("GET", "/settlements", { cookies: jar });

    const row = res.body?.settlements[0];
    expect(row.destination).toBe(`0x${"11".repeat(20)}`);
    expect(row.chain.txHash).toBe(`0x${"ee".repeat(32)}`);
    expect(row.chain.blockNumber).toBe("42");
    // Reported next to the locked figures, never in place of them — a payment
    // where the two disagree is the signal that a route behaved unexpectedly.
    expect(row.settlementAmount.amount).toBe("3000000");
  });
});

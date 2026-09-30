import { describe, expect, test } from "bun:test";
import { InvalidStateTransitionError, money, ValidationError } from "@mayarin/shared";
import {
  billingDate,
  cancelSubscription,
  createSubscription,
  cycleKey,
  isDue,
  markBilled,
  nextBillingAt,
  pauseSubscription,
  resumeSubscription,
} from "../src/subscription.ts";

const at = (iso: string) => new Date(iso);

function subscription(anchorAt = at("2026-01-31T09:00:00.000Z"), interval = "month" as const) {
  return createSubscription({
    id: "sub_1",
    merchantId: "mrc_1",
    subscriber: { customerId: "cus_1", name: "PT Sumber Rejeki", email: "finance@sr.co.id" },
    description: "Pro plan",
    amount: money(49_000_000n, "IDR"),
    interval,
    anchorAt,
    daysUntilDue: 7,
    now: at("2026-01-20T00:00:00.000Z"),
  });
}

describe("billingDate", () => {
  test("a month-end anchor clamps each month and never drifts", () => {
    const anchor = at("2026-01-31T09:00:00.000Z");
    expect([0, 1, 2, 3].map((n) => billingDate(anchor, "month", n).toISOString())).toEqual([
      "2026-01-31T09:00:00.000Z",
      "2026-02-28T09:00:00.000Z",
      "2026-03-31T09:00:00.000Z",
      "2026-04-30T09:00:00.000Z",
    ]);
  });

  test("leap years, and 29 February anchored yearly", () => {
    expect(billingDate(at("2028-01-31T00:00:00.000Z"), "month", 1).toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
    const leapDay = at("2028-02-29T00:00:00.000Z");
    expect(billingDate(leapDay, "year", 1).toISOString()).toBe("2029-02-28T00:00:00.000Z");
    expect(billingDate(leapDay, "year", 4).toISOString()).toBe("2032-02-29T00:00:00.000Z");
  });

  test("weeks are seven days, across the year boundary", () => {
    expect(billingDate(at("2026-12-28T00:00:00.000Z"), "week", 1).toISOString()).toBe(
      "2027-01-04T00:00:00.000Z",
    );
  });
});

describe("the billing cycle", () => {
  test("is due at its date, and billing moves to the next date", () => {
    const sub = subscription();
    expect(isDue(sub, at("2026-01-31T08:59:59.999Z"))).toBe(false);
    expect(isDue(sub, at("2026-01-31T09:00:00.000Z"))).toBe(true);
    expect(cycleKey(sub)).toBe("sub_1:2026-01-31T09:00:00.000Z");

    const billed = markBilled(sub, at("2026-01-31T09:01:00.000Z"));
    expect(billed.version).toBe(2);
    expect(nextBillingAt(billed).toISOString()).toBe("2026-02-28T09:00:00.000Z");
    expect(isDue(billed, at("2026-02-01T00:00:00.000Z"))).toBe(false);
  });

  test("a paused subscription is never due, and resumes without back-billing", () => {
    const paused = pauseSubscription(subscription(), at("2026-01-25T00:00:00.000Z"));
    expect(isDue(paused, at("2026-06-01T00:00:00.000Z"))).toBe(false);

    const resumed = resumeSubscription(paused, at("2026-04-15T00:00:00.000Z"));
    // January through March passed while paused; April's clamped date is next.
    expect(nextBillingAt(resumed).toISOString()).toBe("2026-04-30T09:00:00.000Z");
    expect(resumed.state).toBe("active");
  });

  test("a cancelled subscription stays cancelled and cannot bill", () => {
    const cancelled = cancelSubscription(subscription(), at("2026-01-25T00:00:00.000Z"));
    expect(cancelled.state).toBe("cancelled");
    expect(cancelSubscription(cancelled, at("2026-02-01T00:00:00.000Z"))).toBe(cancelled);
    expect(isDue(cancelled, at("2027-01-01T00:00:00.000Z"))).toBe(false);
    expect(() => markBilled(cancelled, at("2026-02-01T00:00:00.000Z"))).toThrow(
      InvalidStateTransitionError,
    );
    expect(() => resumeSubscription(cancelled, at("2026-02-01T00:00:00.000Z"))).toThrow(
      InvalidStateTransitionError,
    );
  });
});

describe("createSubscription", () => {
  test("refuses a non-positive amount, a blank description, or an odd due window", () => {
    const base = {
      id: "sub_2",
      merchantId: "mrc_1",
      subscriber: { customerId: "cus_1", name: "Budi" },
      description: "Plan",
      amount: money(1n, "USDC"),
      interval: "month" as const,
      anchorAt: at("2026-01-01T00:00:00.000Z"),
      daysUntilDue: 7,
      now: at("2026-01-01T00:00:00.000Z"),
    };
    expect(() => createSubscription({ ...base, amount: money(0n, "USDC") })).toThrow(
      ValidationError,
    );
    expect(() => createSubscription({ ...base, description: "  " })).toThrow(ValidationError);
    expect(() => createSubscription({ ...base, daysUntilDue: 91 })).toThrow(ValidationError);
  });
});

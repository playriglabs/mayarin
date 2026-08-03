import { describe, expect, test } from "bun:test";
import { InvalidStateTransitionError, money, ValidationError } from "@mayarin/shared";
import type { CreatePaymentIntentInput } from "../src/intent.ts";
import {
  canTransition,
  confirm,
  createPaymentIntent,
  isExpired,
  isTerminal,
  markCompleted,
  markExpired,
  markFailed,
  markProcessing,
} from "../src/intent.ts";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function input(overrides: Partial<CreatePaymentIntentInput> = {}): CreatePaymentIntentInput {
  return {
    merchant: { id: "ID1020017611473", name: "Warung Kopi", city: "Jakarta", countryCode: "ID" },
    amount: money(5_000_000n, "IDR"),
    settlementAsset: "IDRX",
    provider: "mock",
    source: { type: "manual" },
    ttlSeconds: 900,
    now: NOW,
    ...overrides,
  };
}

describe("createPaymentIntent", () => {
  test("starts in CREATED with version 1", () => {
    const intent = createPaymentIntent(input());
    expect(intent.status).toBe("CREATED");
    expect(intent.version).toBe(1);
    expect(intent.id).toMatch(/^pi_/);
  });

  test("derives expiry from the TTL", () => {
    const intent = createPaymentIntent(input({ ttlSeconds: 900 }));
    expect(intent.expiresAt.toISOString()).toBe("2026-01-01T00:15:00.000Z");
  });

  test("rejects a non-positive amount", () => {
    expect(() => createPaymentIntent(input({ amount: money(0n, "IDR") }))).toThrow(ValidationError);
    expect(() => createPaymentIntent(input({ amount: money(-1n, "IDR") }))).toThrow(
      ValidationError,
    );
  });

  test("rejects a non-positive TTL", () => {
    expect(() => createPaymentIntent(input({ ttlSeconds: 0 }))).toThrow(ValidationError);
  });

  test("omits optional fields rather than storing undefined", () => {
    const intent = createPaymentIntent(input());
    expect("idempotencyKey" in intent).toBe(false);
    expect("clearingTransactionId" in intent).toBe(false);
  });
});

describe("transitions", () => {
  const created = createPaymentIntent(input());

  test("walk the happy path", () => {
    const confirmed = confirm(created, NOW);
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.confirmedAt).toEqual(NOW);
    expect(confirmed.version).toBe(2);

    const processing = markProcessing(confirmed, "clr_01J8Z3K4M5N6P7Q8R9S0T1U2V3", NOW);
    expect(processing.status).toBe("PROCESSING");
    expect(processing.clearingTransactionId).toBe("clr_01J8Z3K4M5N6P7Q8R9S0T1U2V3");

    const completed = markCompleted(processing, NOW);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.version).toBe(4);
    expect(isTerminal(completed)).toBe(true);
  });

  test("leave the source value untouched", () => {
    confirm(created, NOW);
    expect(created.status).toBe("CREATED");
    expect(created.version).toBe(1);
  });

  test("reject illegal jumps", () => {
    expect(() => markCompleted(created, NOW)).toThrow(InvalidStateTransitionError);
    expect(() => markProcessing(created, "clr_x", NOW)).toThrow(InvalidStateTransitionError);
  });

  test("reject anything after a terminal status", () => {
    const failed = markFailed(created, "provider declined", NOW);
    expect(failed.failureReason).toBe("provider declined");
    expect(() => confirm(failed, NOW)).toThrow(InvalidStateTransitionError);
    expect(() => markExpired(failed, NOW)).toThrow(InvalidStateTransitionError);
  });

  test("expose the transition table", () => {
    expect(canTransition("CREATED", "CONFIRMED")).toBe(true);
    expect(canTransition("CREATED", "COMPLETED")).toBe(false);
    expect(canTransition("COMPLETED", "FAILED")).toBe(false);
  });
});

describe("expiry", () => {
  const intent = createPaymentIntent(input({ ttlSeconds: 60 }));

  test("is due once the deadline passes", () => {
    expect(isExpired(intent, new Date(NOW.getTime() + 59_000))).toBe(false);
    expect(isExpired(intent, new Date(NOW.getTime() + 60_000))).toBe(true);
  });

  test("never applies to a terminal intent", () => {
    const completed = markCompleted(markProcessing(confirm(intent, NOW), "clr_x", NOW), NOW);
    expect(isExpired(completed, new Date(NOW.getTime() + 3_600_000))).toBe(false);
  });

  test("blocks confirmation after the deadline", () => {
    expect(() => confirm(intent, new Date(NOW.getTime() + 60_000))).toThrow(
      InvalidStateTransitionError,
    );
  });
});

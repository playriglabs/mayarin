import { describe, expect, test } from "bun:test";
import { InvalidStateTransitionError, money, ValidationError } from "@mayarin/shared";
import {
  assertPayable,
  createPaymentLink,
  disablePaymentLink,
  isLinkPayable,
  linkCurrency,
} from "../src/link.ts";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const merchant = { id: "mrc_1", name: "Warung Kopi", city: "Jakarta", countryCode: "ID" };

describe("createPaymentLink", () => {
  test("a fixed link carries its amount", () => {
    const link = createPaymentLink({
      kind: "fixed",
      merchant,
      amount: money(5_000_000n, "IDR"),
      now: NOW,
    });
    expect(linkCurrency(link)).toBe("IDR");
  });

  test("an open link carries only a currency — the counter QR shape", () => {
    const link = createPaymentLink({ kind: "open", merchant, currency: "IDR", now: NOW });
    expect(link.amount).toBeUndefined();
    expect(linkCurrency(link)).toBe("IDR");
  });

  test("a catalog link carries lines and the currency they price in", () => {
    const link = createPaymentLink({
      kind: "catalog",
      merchant,
      currency: "IDR",
      lines: [{ productId: "prd_1", quantity: 2 }],
      now: NOW,
    });
    expect(link.lines).toEqual([{ productId: "prd_1", quantity: 2 }]);
  });

  test("refuses a fixed link with no amount", () => {
    expect(() => createPaymentLink({ kind: "fixed", merchant, now: NOW })).toThrow(ValidationError);
  });

  test("refuses an open link with no currency", () => {
    expect(() => createPaymentLink({ kind: "open", merchant, now: NOW })).toThrow(ValidationError);
  });

  test("refuses a catalog link with no lines", () => {
    expect(() =>
      createPaymentLink({ kind: "catalog", merchant, currency: "IDR", lines: [], now: NOW }),
    ).toThrow(ValidationError);
  });

  test("refuses an expiry already in the past", () => {
    expect(() =>
      createPaymentLink({
        kind: "open",
        merchant,
        currency: "IDR",
        expiresAt: new Date(NOW.getTime() - 1),
        now: NOW,
      }),
    ).toThrow(ValidationError);
  });

  test("carries a rail restriction onto the link", () => {
    const link = createPaymentLink({
      kind: "open",
      merchant,
      currency: "IDR",
      rails: [{ chain: "base-sepolia", asset: "USDC" }],
      now: NOW,
    });
    expect(link.rails).toEqual([{ chain: "base-sepolia", asset: "USDC" }]);
  });

  test("a link without a restriction carries none — the default", () => {
    const link = createPaymentLink({ kind: "open", merchant, currency: "IDR", now: NOW });
    expect(link.rails).toBeUndefined();
  });

  test("refuses a restriction to zero rails", () => {
    expect(() =>
      createPaymentLink({ kind: "open", merchant, currency: "IDR", rails: [], now: NOW }),
    ).toThrow(/zero rails/);
  });
});

describe("payability", () => {
  const link = createPaymentLink({ kind: "open", merchant, currency: "IDR", now: NOW });

  test("a link with no expiry outlives any single sale", () => {
    expect(isLinkPayable(link, new Date("2027-01-01T00:00:00.000Z"))).toBe(true);
  });

  test("an expired link refuses to mint", () => {
    const expiring = createPaymentLink({
      kind: "open",
      merchant,
      currency: "IDR",
      expiresAt: new Date(NOW.getTime() + 60_000),
      now: NOW,
    });
    expect(() => assertPayable(expiring, new Date(NOW.getTime() + 60_000))).toThrow(
      InvalidStateTransitionError,
    );
  });

  test("a disabled link refuses to mint", () => {
    const disabled = disablePaymentLink(link, NOW);
    expect(() => assertPayable(disabled, NOW)).toThrow(InvalidStateTransitionError);
  });

  test("disabling twice is a no-op rather than a second version", () => {
    const disabled = disablePaymentLink(link, NOW);
    expect(disablePaymentLink(disabled, NOW)).toBe(disabled);
  });
});

import { describe, expect, test } from "bun:test";
import { cartSnapshot } from "@mayarin/catalog";
import type { Invoice } from "@mayarin/invoicing";
import { ConflictError, money } from "@mayarin/shared";
import { derivedNumber, invoiceDocument, receiptDocument } from "../src/document.ts";
import { COMPLETED, CREATED, HASH, intent, merchant, transaction } from "./fixtures.ts";

describe("derivedNumber", () => {
  test("takes the last eight characters, split in two", () => {
    expect(derivedNumber("pi_01J8ZQ4T5E7V9XK2M3N4P5Q6R7")).toBe("N4P5-Q6R7");
  });
});

describe("invoiceDocument", () => {
  test("the seller carries the merchant's logo when one is given", () => {
    const doc = invoiceDocument({
      intent: intent(),
      transaction: transaction(),
      merchantLogoUrl: "https://pub-test.r2.dev/logo.png",
    });

    expect(doc.seller.logoUrl).toBe("https://pub-test.r2.dev/logo.png");
  });

  test("a plain payment prints one line for the whole amount", () => {
    const doc = invoiceDocument({ intent: intent(), transaction: transaction() });

    expect(doc.kind).toBe("invoice");
    expect(doc.invoiceNumber).toBe(derivedNumber("pi_01J8ZQ4T5E7V9XK2M3N4P5Q6R7"));
    expect(doc.seller).toEqual({ name: "Warung Kopi", lines: ["Jakarta", "ID"] });
    expect(doc.billTo).toBeUndefined();
    expect(doc.lines).toEqual([
      {
        description: "Payment to Warung Kopi",
        quantity: 1,
        unitPrice: money(5_000_000n, "IDR"),
        amount: money(5_000_000n, "IDR"),
      },
    ]);
    expect(doc.payment).toBeUndefined();
  });

  test("a cart payment prints its frozen lines", () => {
    const metadata = {
      cart: cartSnapshot({
        total: money(5_000_000n, "IDR"),
        lines: [
          { name: "Beans", unitPrice: money(1_500_000n, "IDR"), quantity: 2 },
          { name: "Filter", unitPrice: money(2_000_000n, "IDR"), quantity: 1 },
        ],
      }),
    };
    const doc = invoiceDocument({ intent: intent({ metadata }), transaction: null });

    expect(doc.lines.map((line) => [line.description, line.amount.amount])).toEqual([
      ["Beans", 3_000_000n],
      ["Filter", 2_000_000n],
    ]);
  });

  test("an invoice payment prints the invoice's number, buyer and dates", () => {
    const invoice: Invoice = {
      id: "inv_1",
      merchantId: "mrc_1",
      merchant,
      state: "issued",
      currency: "IDR",
      total: money(5_000_000n, "IDR"),
      metadata: {},
      listed: false,
      createdAt: CREATED,
      updatedAt: CREATED,
      version: 1,
      number: "INV/2026/0007",
      buyer: { name: "PT Sumber Rejeki", email: "finance@sr.co.id", taxId: "01.234" },
      lines: [{ name: "Consulting", unitPrice: money(5_000_000n, "IDR"), quantity: 1 }],
      notes: "Thank you",
      issuedAt: new Date("2026-09-01T00:00:00.000Z"),
      dueAt: new Date("2026-09-30T00:00:00.000Z"),
    };
    const doc = invoiceDocument({ intent: intent(), transaction: null, invoice });

    expect(doc.invoiceNumber).toBe("INV/2026/0007");
    expect(doc.billTo).toEqual({
      name: "PT Sumber Rejeki",
      lines: ["finance@sr.co.id", "Tax ID 01.234"],
    });
    expect(doc.memo).toBe("Thank you");
    expect(doc.dueAt).toEqual(new Date("2026-09-30T00:00:00.000Z"));
  });

  test("falls back to the payer's address when nothing else names a buyer", () => {
    const payerAddress = `0x${"22".repeat(20)}`;
    const doc = invoiceDocument({
      intent: intent({ payment: { asset: "USDC", chain: "arbitrum-sepolia", payerAddress } }),
      transaction: null,
    });

    expect(doc.billTo).toEqual({ name: "Payer", lines: [payerAddress] });
  });
});

describe("receiptDocument", () => {
  test("refuses a payment that has not completed", () => {
    expect(() =>
      receiptDocument({ intent: intent({ status: "PROCESSING" }), transaction: transaction() }),
    ).toThrow(ConflictError);
  });

  test("prints the settlement proof of a deposit-match payment", () => {
    const doc = receiptDocument({
      intent: intent(),
      transaction: transaction(),
      fundingTxHash: HASH,
    });

    expect(doc.kind).toBe("receipt");
    expect(doc.dueAt).toBeUndefined();
    expect(doc.paidAt).toEqual(COMPLETED);
    expect(doc.receiptNumber).toBe(derivedNumber("clr_01J8ZQ4T5E7V9XK2M3N4PABCD9"));
    expect(doc.payment).toEqual({
      paidWith: money(3_000_000n, "USDC"),
      network: "arbitrum-sepolia",
      rate: { from: "IDR", per: money(60n, "USDC") },
      settled: money(3_000_000n, "USDC"),
      fee: money(30_000n, "USDC"),
      net: money(2_970_000n, "USDC"),
      transactionHash: HASH,
      explorerUrl: `https://sepolia.arbiscan.io/tx/${HASH}`,
    });
  });

  test("an x402 payment's settlement reference is its transaction", () => {
    const { deposit: _deposit, ...rest } = transaction({
      executionPath: "x402",
      providerReference: HASH,
    });
    const doc = receiptDocument({ intent: intent({ executionPath: "x402" }), transaction: rest });

    expect(doc.payment?.network).toBe("arbitrum-sepolia");
    expect(doc.payment?.transactionHash).toBe(HASH);
  });

  test("the rate comes from the frozen amounts, not the locked leg (HKD 100 → 12.744634 USDG)", () => {
    const doc = receiptDocument({
      intent: intent(),
      transaction: transaction({
        sourceAmount: money(10_000n, "HKD"),
        settlementAmount: money(12_744_634n, "USDG"),
        rate: {
          from: "USDG",
          to: "USDG",
          scaledRate: 1_000_000_000n,
          source: "fx",
          lockedAt: CREATED,
        },
      }),
    });

    expect(doc.payment?.rate).toEqual({ from: "HKD", per: money(127_446n, "USDG") });
  });

  test("no rate when the merchant priced in the settlement asset itself", () => {
    const doc = receiptDocument({
      intent: intent(),
      transaction: transaction({ sourceAmount: money(3_000_000n, "USDC") }),
    });

    expect(doc.payment?.rate).toBeUndefined();
  });

  test("a settlement reference that is not a hash is not printed as one", () => {
    const doc = receiptDocument({
      intent: intent(),
      transaction: transaction({ providerReference: "stl_123" }),
    });

    expect(doc.payment?.transactionHash).toBeUndefined();
    expect(doc.payment?.explorerUrl).toBeUndefined();
  });
});

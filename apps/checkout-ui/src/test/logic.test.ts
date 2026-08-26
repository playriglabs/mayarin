import { describe, expect, test } from "bun:test";
import { checkoutBody } from "../features/link/checkout-body.ts";
import type { LinkBootstrap } from "../features/link/types.ts";
import { remainingAt } from "../features/pay/countdown.ts";
import { usableDeposit } from "../features/pay/payment-status.ts";
import { isTerminal, paymentStage, statusWording } from "../features/pay/status-wording.ts";
import { currencySymbol } from "../shared/currency.ts";
import { walletAmount } from "../shared/money.ts";

describe("wallet amount", () => {
  test("trims trailing zeros from the machine decimal and nothing else", () => {
    expect(walletAmount("3.500000")).toBe("3.5");
    expect(walletAmount("50000.00")).toBe("50000");
    expect(walletAmount("0.000001")).toBe("0.000001");
    expect(walletAmount("0.000000")).toBe("0");
  });

  test("leaves a whole number untouched", () => {
    expect(walletAmount("3500000")).toBe("3500000");
  });
});

describe("currency symbols", () => {
  test("uses the familiar symbol for counter checkout fiat currencies", () => {
    expect(currencySymbol("SGD")).toBe("S$");
    expect(currencySymbol("IDR")).toBe("Rp");
    expect(currencySymbol("MYR")).toBe("RM");
    expect(currencySymbol("USD")).toBe("$");
  });

  test("falls back to the currency code when no symbol is registered", () => {
    expect(currencySymbol("EUR")).toBe("EUR");
    expect(currencySymbol(null)).toBe("");
  });
});

describe("payment status deposit", () => {
  test("treats the API's pre-confirmation null deposit as still preparing", () => {
    expect(
      usableDeposit({
        paymentIntent: { status: "REQUIRES_CONFIRMATION" },
        deposit: null,
      }),
    ).toBeUndefined();
  });
});

function linkBootstrap(overrides: Partial<LinkBootstrap> = {}): LinkBootstrap {
  return {
    page: "link",
    linkId: "plk_1",
    kind: "fixed",
    title: "Paket",
    merchant: { name: "Warung Kopi", city: "Jakarta" },
    payable: true,
    currency: "IDR",
    total: {
      amount: "5000000",
      asset: "IDR",
      formatted: "50000.00",
      display: "Rp 50.000,00",
    },
    lines: null,
    accepted: ["USDC"],
    chain: "base-sepolia",
    lockMinutes: 15,
    ...overrides,
  };
}

describe("countdown", () => {
  const expires = "2026-01-01T00:15:00.000Z";

  test("renders minutes and seconds, zero-padded", () => {
    const at = new Date("2026-01-01T00:10:53.000Z").getTime();
    expect(remainingAt(expires, at)).toEqual({ text: "04:07", low: false, expired: false });
  });

  test("turns warning-coloured for the last minute", () => {
    const at = new Date("2026-01-01T00:14:01.000Z").getTime();
    expect(remainingAt(expires, at)).toEqual({ text: "00:59", low: true, expired: false });
  });

  test("expires rather than counting negative", () => {
    const at = new Date("2026-01-01T00:15:00.001Z").getTime();
    expect(remainingAt(expires, at)).toEqual({ text: "expired", low: false, expired: true });
  });
});

describe("status wording", () => {
  test("speaks the payer's language, not the machine's", () => {
    expect(statusWording("PENDING")).toEqual(["waiting for payment", "live"]);
    expect(statusWording("COMPLETED")).toEqual(["payment completed", "done"]);
    expect(statusWording("EXPIRED")).toEqual(["payment expired", "bad"]);
  });

  test("an unknown status is shown lowercased rather than hidden", () => {
    expect(statusWording("SOMETHING_NEW")).toEqual(["something_new", ""]);
  });

  test("exactly three statuses end the page's work", () => {
    expect(isTerminal("COMPLETED")).toBe(true);
    expect(isTerminal("FAILED")).toBe(true);
    expect(isTerminal("EXPIRED")).toBe(true);
    expect(isTerminal("PROCESSING")).toBe(false);
  });
});

describe("payment stage", () => {
  test("only a clearing state that saw money counts as confirming", () => {
    expect(paymentStage("ASSET_RECEIVED")).toBe("confirming");
    expect(paymentStage("CLEARING")).toBe("confirming");
    expect(paymentStage("SETTLING")).toBe("confirming");
    expect(paymentStage("SETTLED")).toBe("confirming");
  });

  test("a confirmed intent is still waiting — pressing Continue moves no money", () => {
    expect(paymentStage("")).toBe("waiting");
    expect(paymentStage("PRICE_LOCKED")).toBe("waiting");
    expect(paymentStage("PAYMENT_PENDING")).toBe("waiting");
    expect(paymentStage("CONFIRMED")).toBe("waiting");
  });
});

describe("checkout body", () => {
  test("asks for the deposit path, whatever the deployment default is", () => {
    // The page renders an address and a QR. The contract path needs the
    // payer's own wallet to sign the router call, and there is no wallet to
    // connect here, so a deployment defaulting to it would fail every hosted
    // checkout.
    const body = checkoutBody(linkBootstrap(), "", "USDC");
    expect(body).toEqual({
      payment: { asset: "USDC", chain: "base-sepolia" },
      executionPath: "deposit-match",
    });
  });

  test("an open link sends the typed amount in the link's currency", () => {
    const body = checkoutBody(linkBootstrap({ kind: "open", total: null }), " 25000 ", "USDC");
    expect(body["amount"]).toEqual({ amount: "25000", asset: "IDR" });
  });

  test("a priced link never sends an amount of its own", () => {
    const body = checkoutBody(linkBootstrap(), "999", "USDC");
    expect(body["amount"]).toBeUndefined();
  });
});

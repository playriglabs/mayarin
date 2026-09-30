import { describe, expect, test } from "bun:test";
import { csvCell, csvLine, PAYMENT_CSV_COLUMNS, paymentCsvRow } from "../src/csv.ts";
import { HASH, intent, transaction } from "./fixtures.ts";

function row(cells: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    PAYMENT_CSV_COLUMNS.map((column, index) => [column, cells[index] ?? ""]),
  );
}

describe("paymentCsvRow", () => {
  test("a settled payment carries machine-form amounts and its proof", () => {
    const cells = paymentCsvRow(
      intent({ merchantReference: "ORD-7", metadata: { invoiceId: "inv_1", customerId: "cus_1" } }),
      transaction({ executionPath: "x402", providerReference: HASH }),
    );

    expect(cells).toHaveLength(PAYMENT_CSV_COLUMNS.length);
    expect(row(cells)).toEqual({
      payment_id: "pi_01J8ZQ4T5E7V9XK2M3N4P5Q6R7",
      created_at: "2026-09-23T10:00:00.000Z",
      completed_at: "2026-09-23T10:05:00.000Z",
      status: "COMPLETED",
      merchant_reference: "ORD-7",
      invoice_id: "inv_1",
      customer_id: "cus_1",
      amount: "50000.00",
      currency: "IDR",
      paid_asset: "USDC",
      paid_amount: "3.000000",
      network: "arbitrum-sepolia",
      rate: "0.000060",
      rate_source: "coinbase",
      settlement_asset: "USDC",
      settlement_amount: "3.000000",
      fee: "0.030000",
      net_amount: "2.970000",
      transaction_hash: HASH,
      failure_reason: "",
    });
  });

  test("an intent that never reached clearing leaves the clearing columns empty", () => {
    const { payment: _payment, ...fiatOnly } = intent({ status: "EXPIRED" });
    const cells = row(paymentCsvRow(fiatOnly, null));

    expect(cells.status).toBe("EXPIRED");
    expect(cells.paid_amount).toBe("");
    expect(cells.network).toBe("");
    expect(cells.rate).toBe("");
    expect(cells.transaction_hash).toBe("");
  });
});

describe("csvCell", () => {
  test("quotes separators, quotes and newlines", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });

  test("defuses a spreadsheet formula a merchant typed", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  test("a line ends in CRLF", () => {
    expect(csvLine(["a", "b"])).toBe("a,b\r\n");
  });
});

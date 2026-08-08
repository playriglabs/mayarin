import { describe, expect, test } from "bun:test";
import { money, NotFoundError } from "@mayarin/shared";
import {
  event,
  harness,
  MERCHANT_ID,
  NOW,
  postFullSettlement,
  recordConfirmedSettlement,
  settledTransaction,
} from "./harness.ts";

describe("ComplianceService.record", () => {
  test("reconstructs a payment from clearing, ledger and chain", async () => {
    const { service, clearing, ledger, settlements } = harness();
    const transaction = settledTransaction();

    await clearing.insert(transaction, [
      event(transaction, 1, "CREATED"),
      event(transaction, 2, "PRICE_LOCKED"),
      event(transaction, 3, "SUCCESS"),
    ]);
    await postFullSettlement(ledger, transaction);
    await recordConfirmedSettlement(settlements, { settledAmount: 2_990_000n, fee: 10_000n });

    const record = await service.record(MERCHANT_ID, transaction.id);

    expect(record.transaction.id).toBe(transaction.id);
    expect(record.history.map((entry) => entry.toState)).toEqual([
      "CREATED",
      "PRICE_LOCKED",
      "SUCCESS",
    ]);
    // Three postings: ASSET_RECEIVED, CLEARING, SETTLED.
    expect(record.postings).toHaveLength(3);
    expect(record.settlement?.intentId).toBe(transaction.contract?.order.intentId ?? "");
    expect(record.reconciliation).toEqual({
      status: "MATCHED",
      net: money(2_990_000n, "USDC"),
      fee: money(10_000n, "USDC"),
    });
  });

  test("reports a mismatch when the chain paid a different amount than the ledger booked", async () => {
    const { service, clearing, ledger, settlements } = harness();
    const transaction = settledTransaction();

    await clearing.insert(transaction, []);
    await postFullSettlement(ledger, transaction);
    // One minor unit short of the net the ledger credited.
    await recordConfirmedSettlement(settlements, { settledAmount: 2_989_999n, fee: 10_000n });

    const record = await service.record(MERCHANT_ID, transaction.id);

    expect(record.reconciliation).toEqual({
      status: "MISMATCHED",
      differences: [
        { field: "net", ledger: money(2_990_000n, "USDC"), onChain: money(2_989_999n, "USDC") },
      ],
    });
  });

  test("says nobody checked when no confirmed settlement exists", async () => {
    const { service, clearing, ledger } = harness();
    const transaction = settledTransaction();

    await clearing.insert(transaction, []);
    await postFullSettlement(ledger, transaction);

    const record = await service.record(MERCHANT_ID, transaction.id);

    expect(record.reconciliation).toEqual({ status: "NO_ON_CHAIN_RECORD" });
    expect(record.settlement).toBeUndefined();
  });

  test("an unconfirmed settlement is carried but not reconciled against", async () => {
    const { service, clearing, ledger, settlements } = harness();
    const transaction = settledTransaction();

    await clearing.insert(transaction, []);
    await postFullSettlement(ledger, transaction);
    // Recorded, never confirmed: below the depth it has told the engine nothing.
    await settlements.record(
      [
        {
          chain: "base-sepolia",
          txHash: "0xbeef",
          logIndex: 0,
          blockNumber: 100n,
          blockHash: "0xblock",
          intentId: transaction.contract?.order.intentId ?? "",
          merchantSafe: "0x0000000000000000000000000000000000000002",
          settledAmount: 2_990_000n,
          fee: 10_000n,
          refundAmount: 0n,
        },
      ],
      NOW,
    );

    const record = await service.record(MERCHANT_ID, transaction.id);

    expect(record.settlement?.status).toBe("PENDING");
    expect(record.reconciliation).toEqual({ status: "NO_ON_CHAIN_RECORD" });
  });

  test("throws NotFoundError for an unknown payment", async () => {
    const { service } = harness();
    await expect(service.record(MERCHANT_ID, "clr_missing")).rejects.toThrow(NotFoundError);
  });

  test("another merchant's payment is not found, not forbidden", async () => {
    const { service, clearing } = harness();
    const transaction = settledTransaction();
    await clearing.insert(transaction, []);

    // Same error an absent id raises, so the response cannot be used to probe
    // whether a payment exists in another tenant.
    await expect(service.record("M-2", transaction.id)).rejects.toThrow(NotFoundError);
  });
});

describe("ComplianceService.listPayments", () => {
  test("scopes to one merchant, newest first", async () => {
    const { service, audits } = harness();
    const older = settledTransaction({ id: "clr_older", createdAt: new Date("2026-01-01") });
    const newer = settledTransaction({ id: "clr_newer", createdAt: new Date("2026-03-01") });
    const other = settledTransaction({
      id: "clr_other",
      merchant: { id: "M-2", name: "Other", city: "Bandung", countryCode: "ID" },
    });

    audits.add(older, newer, other);

    const rows = await service.listPayments({ merchantId: MERCHANT_ID });

    expect(rows.map((row) => row.clearingTransactionId)).toEqual(["clr_newer", "clr_older"]);
    expect(rows[0]?.merchantId).toBe(MERCHANT_ID);
  });

  test("the window includes `from` and excludes `to`, so adjacent windows do not double count", async () => {
    const { service, audits } = harness();
    const boundary = new Date("2026-02-01T00:00:00.000Z");

    audits.add(
      settledTransaction({ id: "clr_before", createdAt: new Date("2026-01-31T23:59:59.999Z") }),
      settledTransaction({ id: "clr_on_from", createdAt: boundary }),
    );

    const first = await service.listPayments({ merchantId: MERCHANT_ID, to: boundary });
    const second = await service.listPayments({ merchantId: MERCHANT_ID, from: boundary });

    expect(first.map((row) => row.clearingTransactionId)).toEqual(["clr_before"]);
    expect(second.map((row) => row.clearingTransactionId)).toEqual(["clr_on_from"]);
  });

  test("filters on the settlement asset", async () => {
    const { service, audits } = harness();
    audits.add(
      settledTransaction({ id: "clr_usdc", settlementAsset: "USDC" }),
      settledTransaction({ id: "clr_idrx", settlementAsset: "IDRX" }),
    );

    const rows = await service.listPayments({ merchantId: MERCHANT_ID, asset: "IDRX" });

    expect(rows.map((row) => row.clearingTransactionId)).toEqual(["clr_idrx"]);
  });
});

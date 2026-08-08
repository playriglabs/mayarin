import {
  InMemoryDepositRepository,
  InMemorySettlementEventRepository,
} from "@mayarin/chain/testing";
import type { ClearingEvent, ClearingTransaction } from "@mayarin/clearing";
import { assetReceivedPosting, clearingPosting, internalSettledPosting } from "@mayarin/clearing";
import { InMemoryClearingRepository } from "@mayarin/clearing/testing";
import { LedgerService } from "@mayarin/ledger";
import { InMemoryLedgerRepository } from "@mayarin/ledger/testing";
import { InMemoryPaymentIntentRepository } from "@mayarin/payment-intent/testing";
import { FixedClock, money } from "@mayarin/shared";
import { ComplianceService } from "../src/index.ts";
import { InMemoryAuditQueryRepository } from "../testing/index.ts";

export const NOW = new Date("2026-02-01T00:00:00.000Z");
export const MERCHANT_ID = "M-1";
export const INTENT_ID = "0xabc0000000000000000000000000000000000000000000000000000000000001";

/**
 * A settled contract-path payment: 50,000.00 IDR priced into 3.000000 USDC,
 * 0.010000 fee, 2.990000 net.
 */
export function settledTransaction(
  overrides: Partial<ClearingTransaction> = {},
): ClearingTransaction {
  return {
    id: "clr_01J8Z3K4M5N6P7Q8R9S0T1U2V3",
    paymentIntentId: "pint_01J8Z3K4M5N6P7Q8R9S0T1U2V3",
    state: "SUCCESS",
    merchant: { id: MERCHANT_ID, name: "Warung Kopi", city: "Jakarta", countryCode: "ID" },
    sourceAmount: money(5_000_000n, "IDR"),
    settlementAsset: "USDC",
    provider: "payment-router",
    executionPath: "on-chain-contract",
    settlementAmount: money(3_000_000n, "USDC"),
    fee: money(10_000n, "USDC"),
    netAmount: money(2_990_000n, "USDC"),
    contract: {
      order: {
        intentId: INTENT_ID,
        settlementToken: "0x0000000000000000000000000000000000000001",
        minOut: 3_000_000n,
        fee: 10_000n,
        merchantSafe: "0x0000000000000000000000000000000000000002",
        refundTo: "0x0000000000000000000000000000000000000003",
        deadline: 1_800_000_000n,
        signature: "0xsig",
        signer: "0x0000000000000000000000000000000000000004",
      },
      payerEstimate: money(1_050_000_000_000_000n, "ETH"),
      expiresAt: new Date(NOW.getTime() + 60_000),
    },
    createdAt: NOW,
    updatedAt: NOW,
    version: 8,
    ...overrides,
  };
}

export function event(
  transaction: ClearingTransaction,
  sequence: number,
  toState: ClearingTransaction["state"],
): ClearingEvent {
  return {
    id: `evt_${sequence}`,
    clearingTransactionId: transaction.id,
    sequence,
    type: "state.changed",
    toState,
    payload: {},
    occurredAt: NOW,
  };
}

export interface Harness {
  readonly service: ComplianceService;
  readonly audits: InMemoryAuditQueryRepository;
  readonly clearing: InMemoryClearingRepository;
  readonly ledger: LedgerService;
  readonly deposits: InMemoryDepositRepository;
  readonly settlements: InMemorySettlementEventRepository;
}

export function harness(): Harness {
  const clock = new FixedClock(NOW);
  const audits = new InMemoryAuditQueryRepository();
  const clearing = new InMemoryClearingRepository();
  const ledgerRepository = new InMemoryLedgerRepository(clock);
  const ledger = new LedgerService({ repository: ledgerRepository, clock });
  const intents = new InMemoryPaymentIntentRepository();
  const deposits = new InMemoryDepositRepository();
  const settlements = new InMemorySettlementEventRepository();

  const service = new ComplianceService({
    audits,
    clearing,
    ledger: ledgerRepository,
    intents,
    deposits,
    settlements,
  });

  return { service, audits, clearing, ledger, deposits, settlements };
}

/** Books the three postings a fully settled payment produces. */
export async function postFullSettlement(
  ledger: LedgerService,
  transaction: ClearingTransaction,
): Promise<void> {
  await ledger.post(assetReceivedPosting(transaction));
  await ledger.post(clearingPosting(transaction));
  await ledger.post(internalSettledPosting(transaction));
}

/** Records a `PaymentCompleted` log and confirms it past the depth. */
export async function recordConfirmedSettlement(
  settlements: InMemorySettlementEventRepository,
  values: { settledAmount: bigint; fee: bigint },
): Promise<void> {
  const [recorded] = await settlements.record(
    [
      {
        chain: "base-sepolia",
        txHash: "0xdead",
        logIndex: 0,
        blockNumber: 100n,
        blockHash: "0xblock",
        intentId: INTENT_ID,
        merchantSafe: "0x0000000000000000000000000000000000000002",
        settledAmount: values.settledAmount,
        fee: values.fee,
        refundAmount: 0n,
      },
    ],
    NOW,
  );

  if (recorded === undefined) throw new Error("settlement was not recorded");
  await settlements.updateStatuses([{ id: recorded.id, status: "CONFIRMED", at: NOW }]);
}

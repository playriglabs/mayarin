import type { ChainId } from "@mayarin/chain";
import type { QrScheme } from "@mayarin/qr-parser";
import type { AssetCode, Money } from "@mayarin/shared";

/**
 * Payment intent lifecycle.
 *
 * `CREATED → CONFIRMED → PROCESSING → COMPLETED` is the happy path from the
 * README. `FAILED` and `EXPIRED` are the terminal outcomes that path can end in
 * — without them an intent whose clearing failed would be stuck in `PROCESSING`
 * forever, which is unrepresentable state, not a design choice.
 */
export const PAYMENT_INTENT_STATUSES = [
  "CREATED",
  "CONFIRMED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "EXPIRED",
] as const;

export type PaymentIntentStatus = (typeof PAYMENT_INTENT_STATUSES)[number];

/**
 * Merchant details as they were at intent creation.
 *
 * A snapshot, not a reference: what the payer agreed to pay must stay readable
 * even if the merchant record changes later.
 */
export interface MerchantSnapshot {
  readonly id: string;
  readonly name: string;
  readonly city: string;
  readonly countryCode: string;
  readonly categoryCode?: string;
}

/** Where the intent came from, kept for audit and provider re-presentation. */
export type PaymentSource =
  | { readonly type: "qr"; readonly scheme: QrScheme; readonly payload: string }
  | { readonly type: "manual" };

/**
 * An immutable payment request.
 *
 * Nothing mutates a `PaymentIntent`; transitions return a new value with an
 * incremented `version`, which is also the optimistic-locking token used by
 * repositories.
 */
/**
 * The rail the payer intends to pay on.
 *
 * Distinct from both `amount.asset` (what the merchant quoted) and
 * `settlementAsset` (what the merchant is paid): a payer settling an IDR bill
 * with USDC on Base involves all three.
 */
export interface PaymentRail {
  readonly asset: AssetCode;
  readonly chain: ChainId;
  /**
   * The address the payer pays from, needed by the on-chain-contract path:
   * the signed order's `refundTo` returns execution excess and unconsumed
   * input there. The deposit-match path has no use for it — any sender can
   * fund a deposit address.
   */
  readonly payerAddress?: string;
}

/**
 * How a payment rail is executed.
 *
 * `"deposit-match"`: the payer's asset arrives at a per-intent deposit address
 * and the watcher drives `ASSET_RECEIVED`. `"on-chain-contract"`:
 * `PaymentRouter.sol` receives, swaps and settles atomically in one transaction,
 * and `recordPaymentCompleted` drives `ASSET_RECEIVED`. `"x402"`: the payer
 * signs an EIP-3009 authorization, a facilitator broadcasts it, and
 * `recordAssetReceived` drives the transition once the transfer has been read
 * back off the chain.
 *
 * None is a fallback for another — they serve different payers. The contract
 * path needs the payer to *connect* a wallet, because it submits calldata and
 * because the signed order's `refundTo` must be known before the payer pays. A
 * payer who scans a QR or pastes an address into a custodial withdrawal can
 * only do a plain transfer, so deposit-matching is the only path open to them.
 * An `x402` payer is a program: it never sees an address, and the payment is
 * identified by the authorization nonce rather than by where the money landed —
 * which is why that path derives no deposit address at all.
 *
 * Chosen per payer, not per deployment.
 */
export const EXECUTION_PATHS = ["deposit-match", "on-chain-contract", "x402"] as const;

export type ExecutionPath = (typeof EXECUTION_PATHS)[number];

/**
 * Whether this path is funded by a transfer to a per-intent deposit address.
 *
 * A named predicate rather than `path !== "on-chain-contract"`, which is how
 * every site here used to ask the question. That phrasing was correct while
 * there were two paths and silently wrong the moment there were three: `x402`
 * is not the contract path, so every one of those tests would have answered
 * "deposit" for it and gone looking for an address that does not exist.
 *
 * The same shape of bug as `chain === "base"` deciding whether a chain carried
 * real value. The fix is the same: ask the question you mean.
 */
/**
 * Whether this path waits for a facilitator to broadcast a signed
 * authorization, rather than for money to arrive on its own.
 *
 * The distinction matters to anything that stands in for the wallet watcher:
 * an x402 payment is confirmed by reading its settlement transaction back off
 * the chain, so a development shortcut that confirms receipt on a timer must
 * not reach it.
 */
export function awaitsFacilitatorSettlement(path: ExecutionPath | undefined): boolean {
  return path === "x402";
}

export function usesDepositAddress(path: ExecutionPath | undefined): boolean {
  // `undefined` counts, because the field's own default is deposit-match: an
  // intent whose deployment configured no default still funds through an
  // address. Reading it as "not deposit" here would quietly stop planning the
  // executable deposits those intents already rely on.
  return path === undefined || path === "deposit-match";
}

export interface PaymentIntent {
  readonly id: string;
  readonly status: PaymentIntentStatus;
  readonly merchant: MerchantSnapshot;
  /** What the merchant is owed, denominated in the currency they quoted. */
  readonly amount: Money;
  /** Asset Mayarin clears and settles this payment in. */
  readonly settlementAsset: AssetCode;
  /** Settlement provider that will pay the merchant. */
  readonly provider: string;
  /** Absent for a fiat-only intent, which is every Phase 1 intent. */
  readonly payment?: PaymentRail;
  /**
   * How the `payment` rail is executed. Present iff `payment` is present;
   * `undefined` for a fiat-only intent, which has no on-chain execution path.
   * Defaults to `"deposit-match"` (the fallback) until Phase 3 wires the
   * contract path.
   */
  readonly executionPath?: ExecutionPath;
  readonly source: PaymentSource;
  readonly metadata: Readonly<Record<string, string>>;
  /**
   * The merchant's own identifier for whatever this payment settles — their
   * order number, invoice number, table number.
   *
   * A first-class field rather than a metadata key because it is the one thing
   * a merchant looks a payment up by, so it is indexed and filterable. Mayarin
   * never interprets it and never requires it to be unique: two intents may
   * carry the same reference when a first attempt expired and the buyer tried
   * again, and collapsing those into one would lose the failed attempt.
   */
  readonly merchantReference?: string;
  readonly idempotencyKey?: string;
  /**
   * Fingerprint of the creating request. Lets a replayed idempotency key be
   * told apart from a key reused for different parameters.
   */
  readonly requestFingerprint?: string;
  /** Set once clearing starts; the clearing transaction is the execution record. */
  readonly clearingTransactionId?: string;
  readonly failureReason?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt: Date;
  readonly confirmedAt?: Date;
  readonly completedAt?: Date;
  /** Incremented on every transition. Used for optimistic concurrency control. */
  readonly version: number;
}

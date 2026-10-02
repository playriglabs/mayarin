/**
 * Payment wire types, mirrored from the dashboard API DTOs.
 *
 * Read-only: the dashboard has no payment write path. Money crosses the wire as
 * a minor-unit string plus rendered forms (see `MoneyDto`), matching the payment
 * API's `MoneyDto` so a client renders the same `Money` identically.
 */

export interface MoneyDto {
  readonly amount: string;
  readonly asset: string;
  readonly formatted: string;
  readonly display: string;
}

export interface MerchantSnapshot {
  readonly id: string;
  readonly name: string;
  readonly city: string;
  readonly countryCode: string;
  readonly categoryCode?: string;
}

export interface PaymentRail {
  readonly asset: string;
  readonly chain: string;
}

export type PaymentSource =
  | { readonly type: "qr"; readonly scheme: string; readonly payload: string }
  | { readonly type: "manual" };

export type PaymentIntentStatus =
  | "CREATED"
  | "CONFIRMED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "EXPIRED";

export interface PaymentIntentDto {
  readonly id: string;
  readonly status: PaymentIntentStatus;
  readonly merchant: MerchantSnapshot;
  readonly amount: MoneyDto;
  readonly settlementAsset: string;
  readonly provider: string;
  readonly payment: PaymentRail | null;
  /** Conditional settlement (#304); `null` for an ordinary payment. */
  readonly escrow: { readonly holdSeconds: number; readonly arbiter?: string } | null;
  readonly source: PaymentSource;
  readonly merchantReference: string | null;
  readonly metadata: Readonly<Record<string, string>>;
  readonly clearingTransactionId: string | null;
  readonly failureReason: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly confirmedAt: string | null;
  readonly completedAt: string | null;
}

export interface PaymentListResponse {
  readonly payments: readonly PaymentIntentDto[];
  readonly nextCursor: string | null;
}

export interface PaymentListFilter {
  readonly limit?: number;
  readonly q?: string;
  readonly status?: PaymentIntentStatus;
  readonly sort?: "created" | "-created" | "-amount";
  readonly from?: string;
  readonly to?: string;
}

export interface ClearingDto {
  readonly id: string;
  readonly state: string;
  readonly provider: string;
  readonly providerReference: string | null;
  readonly transactionHash: string | null;
  readonly sourceAmount: MoneyDto;
  readonly settlementAmount: MoneyDto | null;
  readonly fee: MoneyDto | null;
  readonly netAmount: MoneyDto | null;
  readonly rate: {
    readonly from: string;
    readonly to: string;
    readonly scaledRate: string;
    readonly source: string;
    readonly lockedAt: string;
  } | null;
  readonly failure: { readonly reason: string; readonly code: string; readonly at: string } | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TimelineEvent {
  readonly sequence: number;
  readonly state: string;
  readonly from: string | null;
  readonly occurredAt: string;
}

export interface PaymentDetailResponse {
  readonly paymentIntent: PaymentIntentDto;
  readonly clearing: ClearingDto | null;
  readonly timeline: readonly TimelineEvent[];
  /** The payment's PDFs (#293); a receipt only once the payment has completed. */
  readonly documents: {
    readonly invoiceUrl: string;
    readonly receiptUrl: string | null;
  };
}

/**
 * What the payer must send, as the payment API reports it.
 *
 * `uri` is an EIP-681 payment URI — the thing a crypto wallet understands when
 * it scans a QR. It is `null` when the asset names nothing transferable on the
 * chain, and a null URI is shown as "no QR" rather than as a guess: a wrong URI
 * moves the payer's funds somewhere unrecoverable.
 */
export interface DepositDto {
  readonly address: string;
  readonly chain: string;
  readonly asset: string;
  readonly amount: MoneyDto;
  readonly uri: string | null;
  readonly received: MoneyDto;
  /** Confirmations a transfer needs before the payment counts as funded. */
  readonly required: number;
}

/** An escrowed payment's hold (#304), from GET `/payments/:id/escrow`. */
export interface EscrowDto {
  readonly chain: string;
  readonly chainId: string;
  readonly factory: string;
  readonly address: string;
  readonly terms: {
    readonly payer: string;
    readonly payee: string;
    readonly arbiter: string;
    readonly releaseAfter: string;
    readonly resolveBy: string;
  };
  readonly outcome: "held" | "released" | "refunded" | "split";
  readonly disputed: boolean;
  /** Settlement-token minor units still held. */
  readonly balance: string;
  /** The dispute bond (#315) in minor units; null on a v1 escrow, which cannot be split. */
  readonly bond: string | null;
  /** Calldata per action, sent to `factory`. The contract decides who may send it. */
  readonly calls: { readonly release: string; readonly refund: string; readonly dispute: string };
  /**
   * Whether the payer's wallet may still take buyer protection (#314) —
   * `flagged` once it has kept losing or kept opening disputes. Never the history.
   */
  readonly payerStanding: "good" | "flagged";
  /** The dispute's case file and thread (#313); null while nobody has disputed. */
  readonly dispute: {
    readonly id: string;
    readonly status: "open" | "released" | "refunded" | "split";
    readonly openedAt: string;
    readonly decidedAt: string | null;
    readonly messages: readonly DisputeMessageDto[];
  } | null;
}

/** One message in a dispute's thread (#313). */
export interface DisputeMessageDto {
  readonly id: string;
  readonly author: "payer" | "merchant" | "arbiter";
  readonly body: string;
  readonly createdAt: string;
}

/** An open dispute in the arbiter's queue (#313), from GET `/disputes`. */
export interface DisputeDto {
  readonly id: string;
  readonly paymentIntentId: string;
  readonly merchantId: string;
  readonly chain: string;
  readonly payer: string;
  readonly payee: string;
  readonly status: "open" | "released" | "refunded" | "split";
  readonly releaseAfter: string;
  readonly resolveBy: string;
  readonly openedAt: string;
  readonly decidedAt: string | null;
}

/** GET `/disputes/:id` — one case for the arbiter. */
export interface DisputeCaseDto {
  readonly dispute: DisputeDto;
  readonly messages: readonly DisputeMessageDto[];
  readonly escrow: EscrowDto;
}

export interface EscrowResponse {
  readonly escrow: EscrowDto | null;
}

/** POST `/payments/:id/escrow/refund` — the transaction for the merchant's wallet. */
export interface EscrowRefundResponse {
  readonly chainId: string;
  readonly transaction: { readonly from: string; readonly to: string; readonly data: string };
}

export interface DepositResponse {
  /** `null` until a price is locked, and on paths that allocate no address. */
  readonly deposit: DepositDto | null;
  /** Where to fetch the rendered code. `null` when there is no URI to encode. */
  readonly qrUrl: string | null;
}

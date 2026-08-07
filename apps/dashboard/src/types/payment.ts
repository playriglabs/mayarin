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
  readonly source: PaymentSource;
  readonly clearingTransactionId: string | null;
  readonly failureReason: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly confirmedAt: string | null;
  readonly completedAt: string | null;
}

export interface PaymentListResponse {
  readonly payments: readonly PaymentIntentDto[];
}

export interface ClearingDto {
  readonly id: string;
  readonly state: string;
  readonly provider: string;
  readonly providerReference: string | null;
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
}

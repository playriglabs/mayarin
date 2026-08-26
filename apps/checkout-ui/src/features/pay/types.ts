import type { LineItem, MerchantRef, MoneyDto } from "../../shared/types.ts";

/** The payment page: exactly what to send, where, and how long is left. */
export interface PayBootstrap {
  readonly page: "pay";
  readonly intentId: string;
  readonly amount: MoneyDto;
  readonly merchant: MerchantRef;
  readonly title: string;
  readonly lines: readonly LineItem[] | null;
  readonly expiresAt: string;
  readonly statusUrl: string;
  readonly streaming: boolean;
  readonly successUrl: string | null;
  readonly pollMs: number;
}

/** What the status endpoint returns, as far as this page reads it. */
export interface PaymentStatusPayload {
  readonly paymentIntent: {
    readonly status: string;
    readonly failureReason?: string | null;
  };
  /** The clearing engine's own state — the only field that knows whether money arrived. */
  readonly clearing?: {
    readonly state: string;
  } | null;
  readonly deposit?: {
    readonly uri: string | null;
    readonly amount: MoneyDto;
    readonly chain: string;
    readonly address: string;
    readonly received: MoneyDto;
  } | null;
}

/** Where to send funds, once the price lock has allocated an address. */
export type Deposit = NonNullable<PaymentStatusPayload["deposit"]>;

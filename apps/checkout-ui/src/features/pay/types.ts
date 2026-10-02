import type { LineItem, MerchantRef, MoneyDto, Rail } from "../../shared/types.ts";

/** What the payer chooses from, for an intent minted without a rail. */
export interface RailChoice {
  readonly rails: readonly Rail[];
  readonly lockMinutes: number;
}

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
  /**
   * Present while the intent has no rail — a storefront's cart checkout mints
   * one before the buyer has said how they will pay — so the page asks first.
   * `null` once a rail is chosen: the page then shows the payment itself.
   */
  readonly choice: RailChoice | null;
  /**
   * Present when the payment settles into escrow (#304): the payer names the
   * wallet they will release from, and the paid page shows the hold.
   */
  readonly escrow: { readonly holdSeconds: number } | null;
}

/** `GET /v1/payments/:id/escrow`, as far as this page reads it. */
export interface EscrowPayload {
  readonly chainId: string;
  readonly factory: string;
  readonly terms: {
    readonly payer: string;
    readonly payee: string;
    readonly arbiter: string;
    /** ISO time after which an undisputed escrow is releasable by anyone. */
    readonly releaseAfter: string;
  };
  readonly outcome: "held" | "released" | "refunded";
  readonly disputed: boolean;
  readonly calls: { readonly release: string; readonly dispute: string };
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

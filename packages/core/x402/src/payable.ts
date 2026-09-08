/**
 * An obligation an agent can pay over x402 (#273): an invoice's outstanding
 * balance, or a payment link's total.
 *
 * A resource and a payable differ in one thing the `402` machinery cares about:
 * where the price comes from. A resource's price is static registry config; a
 * payable's is a fact about the world when the agent asks (an invoice's
 * outstanding moves as payments land). A dynamic price cannot be honoured by a
 * registry row alone, so the lock between a `402` and its settle is a **quote
 * row** — one live row per obligation, holding the amount that was quoted, the
 * rails exactly as they were offered when it was, and the nonce claim that
 * makes two agents racing one obligation refuse rather than double-pay.
 *
 * Nothing here knows what an invoice or a link is. The application service that
 * joins this port to the commerce layer is the only place both are visible; the
 * rail's domain stays a domain.
 */

import type { ChainId } from "@mayarin/chain";
import type { AssetCode, Money } from "@mayarin/shared";
import type { AcceptedAsset } from "./resource.ts";

export const PAYABLE_KINDS = ["invoice", "link"] as const;

export type PayableKind = (typeof PAYABLE_KINDS)[number];

export function isPayableKind(value: string): value is PayableKind {
  return (PAYABLE_KINDS as readonly string[]).includes(value);
}

/**
 * The merchant-rail source a deployment wires in when it serves payables.
 *
 * The merchant's own settings decide what a payable can be paid on — the same
 * rails a checkout would offer, not a registry the merchant had to re-enter.
 * Structural rather than a class reference, matching how the domain names every
 * other port: the payment-intent layer's rail catalog satisfies it, and so does
 * a test double.
 */
export interface MerchantRails {
  railsFor(merchantId: string): Promise<
    readonly {
      readonly chain: ChainId;
      readonly asset: AssetCode;
      /**
       * The token contract on `chain`. Absent for a native asset — EIP-3009 has
       * no ERC-20 to sign against, so a rail without one is not a payable rail.
       */
      readonly contract?: string;
      /** The merchant's settlement address on `chain`. */
      readonly payTo?: string;
    }[]
  >;
}

export const PAYABLE_QUOTE_STATUSES = ["quoted", "claimed", "settled"] as const;

export type PayableQuoteStatus = (typeof PAYABLE_QUOTE_STATUSES)[number];

/**
 * The lock between a `402` and its settle.
 *
 * `accepts` is a snapshot, not a live view: it is what the payer signed against,
 * so a settle that rebuilds its requirements from it verifies the payment
 * against the terms that were actually offered, never against whatever the
 * merchant changed to in between.
 */
export interface PayableQuote {
  readonly kind: PayableKind;
  readonly obligationId: string;
  readonly merchantId: string;
  /** What the `402` quoted: the invoice's outstanding balance, or the link's total. */
  readonly amount: Money;
  /** The rails exactly as derived and probed when the quote was made. */
  readonly accepts: readonly AcceptedAsset[];
  /** When the quote stops being honoured. A settle past this is refused. */
  readonly expiresAt: Date;
  readonly status: PayableQuoteStatus;
  /**
   * The EIP-3009 nonce that claimed this quote. One authorization per
   * obligation: a second, different nonce is refused while this holds.
   */
  readonly claimedNonce?: string;
  readonly claimedAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type PayableClaimResult =
  | { readonly ok: true; readonly quote: PayableQuote }
  | {
      readonly ok: false;
      readonly reason: "missing" | "expired" | "claimed-by-other";
      readonly quote?: PayableQuote;
    };

export interface PayableQuoteRepository {
  find(kind: PayableKind, obligationId: string): Promise<PayableQuote | undefined>;
  /**
   * Insert or refresh a quote.
   *
   * A refresh must not clobber a live claim — an authorization may already be
   * in flight against the stored row — and it must reset a spent or expired row
   * so an obligation can be paid again after its quote's time was up. The
   * adapter owns that condition; the caller never has to know which state the
   * row was in.
   */
  save(quote: PayableQuote, options: { readonly now: Date }): Promise<void>;
  /**
   * Claims the nonce for a settle, atomically, or says why not.
   *
   * `ok` when the row was `quoted` and unexpired, or when the same nonce is
   * re-presented — a resume must pass regardless of expiry, because the nonce
   * is already spent on-chain and no other path can recover the money.
   * `claimed-by-other` carries the row so the refusal can say since when.
   */
  claim(
    kind: PayableKind,
    obligationId: string,
    nonce: string,
    now: Date,
  ): Promise<PayableClaimResult>;
  /** Records that the obligation was paid; the next `402` resets the row. */
  markSettled(kind: PayableKind, obligationId: string, now: Date): Promise<void>;
}

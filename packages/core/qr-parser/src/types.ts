import type { AssetCode, Money } from "@mayarin/shared";
import type { EmvField } from "./emvco.ts";

/** QR standards Mayarin can decode. New standards are added as profiles. */
export type QrScheme = "QRIS" | "EMVCO";

/**
 * A merchant account information template (EMVCo tags 02–51).
 *
 * Kept in full alongside the normalized fields: settlement adapters routinely
 * need scheme-specific identifiers that the normalized shape deliberately omits.
 */
export interface MerchantAccount {
  readonly tag: string;
  /** Globally unique identifier of the scheme, e.g. "ID.CO.QRIS.WWW". */
  readonly globalUniqueIdentifier?: string;
  /** Merchant PAN (nested tag 01). */
  readonly merchantPan?: string;
  /** Scheme merchant id — NMID for QRIS (nested tag 02). */
  readonly merchantId?: string;
  /** Merchant criteria (nested tag 03), e.g. "UMI" for micro merchants. */
  readonly merchantCriteria?: string;
  readonly fields: readonly EmvField[];
}

export interface AdditionalData {
  readonly billNumber?: string;
  readonly mobileNumber?: string;
  readonly storeLabel?: string;
  readonly loyaltyNumber?: string;
  readonly referenceLabel?: string;
  readonly customerLabel?: string;
  readonly terminalLabel?: string;
  readonly purposeOfTransaction?: string;
}

/**
 * Normalized QR payload.
 *
 * Everything downstream of the parser — payment intents, clearing, adapters —
 * consumes this shape and never the raw payload, so adding a QR standard cannot
 * ripple into the domain.
 */
export interface ParsedQr {
  readonly scheme: QrScheme;
  /** Static QRs carry no amount; the payer supplies it. */
  readonly isStatic: boolean;
  readonly merchantName: string;
  readonly merchantId: string;
  readonly merchantCity: string;
  readonly countryCode: string;
  readonly currency: AssetCode;
  /** Present only on dynamic QRs (EMVCo tag 54). */
  readonly amount?: Money;
  readonly merchantCategoryCode?: string;
  readonly postalCode?: string;
  readonly merchantAccounts: readonly MerchantAccount[];
  readonly additionalData: AdditionalData;
  /** Original payload, retained for audit and provider re-presentation. */
  readonly raw: string;
}

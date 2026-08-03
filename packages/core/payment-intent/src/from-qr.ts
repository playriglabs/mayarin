/**
 * Bridge from a decoded QR payload to intent inputs.
 *
 * Isolated here so the intent aggregate stays independent of QR standards: it
 * accepts a merchant snapshot and an amount, never a payload.
 */

import type { ParsedQr } from "@mayarin/qr-parser";
import { type Money, ValidationError } from "@mayarin/shared";
import type { MerchantSnapshot, PaymentSource } from "./types.ts";

export function merchantFromParsedQr(parsed: ParsedQr): MerchantSnapshot {
  return {
    id: parsed.merchantId,
    name: parsed.merchantName,
    city: parsed.merchantCity,
    countryCode: parsed.countryCode,
    ...(parsed.merchantCategoryCode === undefined
      ? {}
      : { categoryCode: parsed.merchantCategoryCode }),
  };
}

export function sourceFromParsedQr(parsed: ParsedQr): PaymentSource {
  return { type: "qr", scheme: parsed.scheme, payload: parsed.raw };
}

/**
 * Resolves the amount to charge.
 *
 * A dynamic QR carries the amount and it is authoritative — a caller-supplied
 * amount that disagrees is rejected rather than silently overriding the
 * merchant's quote. A static QR carries none, so the caller must supply one.
 */
export function amountFromParsedQr(parsed: ParsedQr, requested?: Money): Money {
  if (parsed.amount === undefined) {
    if (requested === undefined) {
      throw new ValidationError("This QR does not specify an amount; an amount must be supplied", {
        merchantId: parsed.merchantId,
      });
    }
    if (requested.asset !== parsed.currency) {
      throw new ValidationError(
        `Amount must be denominated in ${parsed.currency}, got ${requested.asset}`,
        { expected: parsed.currency, received: requested.asset },
      );
    }
    return requested;
  }

  if (requested !== undefined && !sameMoney(requested, parsed.amount)) {
    throw new ValidationError("Requested amount does not match the amount encoded in the QR", {
      qrAmount: parsed.amount.amount.toString(),
      requestedAmount: requested.amount.toString(),
      asset: parsed.currency,
    });
  }

  return parsed.amount;
}

function sameMoney(a: Money, b: Money): boolean {
  return a.asset === b.asset && a.amount === b.amount;
}

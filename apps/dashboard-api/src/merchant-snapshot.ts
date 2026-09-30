/**
 * The merchant as a document prints them: name, city, country. Shared by the
 * invoice routes and the subscription billing tick, which issue the same
 * documents.
 */

import type { Merchant } from "@mayarin/auth";
import type { MerchantSnapshot } from "@mayarin/payment-intent";
import { ValidationError } from "@mayarin/shared";

export function snapshotOf(merchant: Merchant): MerchantSnapshot {
  const { city, countryCode } = merchant;
  if (city === undefined || countryCode === undefined) {
    const missing = [
      ...(city === undefined ? ["city"] : []),
      ...(countryCode === undefined ? ["country"] : []),
    ];
    throw new ValidationError(
      `Set your ${missing.join(" and ")} in settings before generating an invoice`,
      { merchantId: merchant.id, missing },
    );
  }
  return { id: merchant.id, name: merchant.name, city, countryCode };
}

/**
 * Cart pricing.
 *
 * A cart is a calculator, not an aggregate. It takes priced lines, returns one
 * total, and is then discarded — the Payment Intent it produces is the only
 * thing that persists, and the only source of truth about what is owed.
 *
 * Nothing here writes, reads or waits. That is deliberate: a cart that could be
 * mutated after its intent exists would let the price move after the clearing
 * engine reached `PRICE_LOCKED`, which is not a bug to fix later but a state
 * the engine's invariants say cannot exist.
 */

import { type AssetCode, type Money, money, ValidationError } from "@mayarin/shared";
import type { CartLine, CartTotal } from "./types.ts";

/**
 * Metadata key the line-item snapshot is written under.
 *
 * The snapshot rides on the intent for receipts and audit. Nothing in clearing
 * reads it — clearing settles `intent.amount`, and a snapshot that disagreed
 * with it would change nothing about what the merchant is paid.
 */
export const CART_METADATA_KEY = "cart";

/** Guards a cart against being large enough to be a denial-of-service payload. */
const MAX_LINES = 200;
const MAX_QUANTITY = 100_000;

/**
 * Folds priced lines into a single amount.
 *
 * Every line must already be denominated in `currency`. Mixing currencies in
 * one cart is rejected rather than converted: an FX conversion belongs to the
 * liquidity router at quote time, where it is locked and auditable, not to a
 * summation that no one records.
 */
export function priceCart(lines: readonly CartLine[], currency: AssetCode): CartTotal {
  if (lines.length === 0) {
    throw new ValidationError("A cart must have at least one line", { currency });
  }
  if (lines.length > MAX_LINES) {
    throw new ValidationError(`A cart cannot have more than ${MAX_LINES} lines`, {
      lines: lines.length,
    });
  }

  let total = 0n;

  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new ValidationError(`Line "${line.name}" must have a positive integer quantity`, {
        name: line.name,
        quantity: line.quantity,
      });
    }
    if (line.quantity > MAX_QUANTITY) {
      throw new ValidationError(`Line "${line.name}" exceeds the maximum quantity`, {
        name: line.name,
        quantity: line.quantity,
        maximum: MAX_QUANTITY,
      });
    }
    if (line.unitPrice.asset !== currency) {
      throw new ValidationError(
        `Line "${line.name}" is priced in ${line.unitPrice.asset}, not ${currency}`,
        { name: line.name, lineAsset: line.unitPrice.asset, currency },
      );
    }
    if (line.unitPrice.amount <= 0n) {
      throw new ValidationError(`Line "${line.name}" must have a positive unit price`, {
        name: line.name,
        unitPrice: line.unitPrice.amount.toString(),
      });
    }

    total += line.unitPrice.amount * BigInt(line.quantity);
  }

  return { total: money(total, currency), lines };
}

/**
 * The line-item snapshot as it is stored on the intent.
 *
 * Intent metadata is `Record<string, string>`, so the snapshot is one JSON
 * string under one key. Amounts are minor-unit strings — the same exact
 * representation money takes everywhere else on the wire.
 */
export function cartSnapshot(total: CartTotal): string {
  return JSON.stringify({
    currency: total.total.asset,
    total: total.total.amount.toString(),
    lines: total.lines.map((line) => ({
      ...(line.productId === undefined ? {} : { productId: line.productId }),
      name: line.name,
      unitPrice: line.unitPrice.amount.toString(),
      quantity: line.quantity,
    })),
  });
}

/** Merges a cart snapshot into caller-supplied metadata. */
export function withCartSnapshot(
  metadata: Readonly<Record<string, string>> | undefined,
  total: CartTotal,
): Record<string, string> {
  return { ...metadata, [CART_METADATA_KEY]: cartSnapshot(total) };
}

/** The unit price a product carries in one currency, or `undefined` if unpriced there. */
export function priceIn(prices: readonly Money[], currency: AssetCode): Money | undefined {
  return prices.find((price) => price.asset === currency);
}

/**
 * Shared Zod primitives.
 *
 * Validation lives at the edge; these are the building blocks every edge reuses
 * so that "an amount" or "an id" means the same thing in every API surface.
 */

import { z } from "zod";
import { ASSET_CODES, type AssetCode } from "./asset.ts";
import type { IdPrefix } from "./id.ts";
import { fromDecimalString } from "./money.ts";

export const assetCodeSchema = z.enum(ASSET_CODES as [AssetCode, ...AssetCode[]]);

/** A prefixed ULID, e.g. `pi_01J8Z3K4M5N6P7Q8R9S0T1U2V3`. */
export function idSchema(prefix: IdPrefix) {
  return z
    .string()
    .regex(new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`), `Expected a "${prefix}" id`);
}

/**
 * Money on the wire: minor units as a string, never a JSON number.
 *
 * `{ "amount": "5000000", "asset": "IDR" }` is 50000.00 IDR.
 */
export const moneySchema = z
  .object({
    amount: z.string().regex(/^-?\d+$/, "Amount must be an integer string of minor units"),
    asset: assetCodeSchema,
  })
  .transform(({ amount, asset }) => ({ amount: BigInt(amount), asset }));

/** Money expressed the way a human writes it: `{ "amount": "50000.00", "asset": "IDR" }`. */
export const decimalMoneySchema = z
  .object({
    amount: z.string(),
    asset: assetCodeSchema,
  })
  .transform(({ amount, asset }, ctx) => {
    try {
      return fromDecimalString(amount, asset);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "Invalid amount",
      });
      return z.NEVER;
    }
  });

/** ISO 8601 timestamp accepted as a string, produced as a Date. */
export const timestampSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

/**
 * Client-supplied idempotency key. Free-form but bounded, so a caller can reuse
 * their own order id without us imposing a format.
 */
export const idempotencyKeySchema = z.string().min(8).max(255);

export const metadataSchema = z.record(z.string(), z.string()).default({});

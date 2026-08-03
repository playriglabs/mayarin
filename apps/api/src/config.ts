/**
 * Runtime configuration.
 *
 * Validated once at startup: a deployment with a bad settlement asset or fee
 * should fail to boot, not fail on the first payment.
 */

import { assetCodeSchema, ConfigurationError } from "@mayarin/shared";
import { z } from "zod";

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(3000),
  databaseUrl: z.string().min(1),
  settlementAsset: assetCodeSchema.default("IDRX"),
  feeBasisPoints: z.coerce.number().int().min(0).max(10_000).default(50),
  defaultProvider: z.string().min(1).default("mock"),
  paymentIntentTtlSeconds: z.coerce.number().int().positive().default(900),
  /**
   * `auto` treats a payment as funded when it reaches PAYMENT_PENDING — the
   * Phase 1 stand-in for the wallet watcher Phase 2 introduces. `manual` leaves
   * the payment waiting until something records the receipt.
   */
  assetReceiptMode: z.enum(["auto", "manual"]).default("auto"),
  /** Minor units of the target asset per whole unit of the source asset. */
  exchangeRates: z
    .string()
    .default('{"IDR/IDRX":"100"}')
    .transform((value, ctx) => {
      try {
        const parsed = z.record(z.string(), z.string()).parse(JSON.parse(value));
        return Object.fromEntries(
          Object.entries(parsed).map(([pair, rate]) => [pair, BigInt(rate)]),
        );
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'EXCHANGE_RATES must be JSON like {"IDR/IDRX":"100"}',
        });
        return z.NEVER;
      }
    }),
  mockWebhookSecret: z.string().min(1).optional(),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = configSchema.safeParse({
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    settlementAsset: env.SETTLEMENT_ASSET,
    feeBasisPoints: env.FEE_BASIS_POINTS,
    defaultProvider: env.DEFAULT_SETTLEMENT_PROVIDER,
    paymentIntentTtlSeconds: env.PAYMENT_INTENT_TTL_SECONDS,
    assetReceiptMode: env.ASSET_RECEIPT_MODE,
    exchangeRates: env.EXCHANGE_RATES,
    mockWebhookSecret: env.MOCK_WEBHOOK_SECRET,
  });

  if (!result.success) {
    throw new ConfigurationError("Invalid environment configuration", {
      issues: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    });
  }

  return result.data;
}

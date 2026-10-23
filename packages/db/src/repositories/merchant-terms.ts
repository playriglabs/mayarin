/**
 * Postgres adapter for a merchant's fee and limits: four columns on `merchants`,
 * read at each price lock and written only through here, so they never ride on
 * the merchant row's optimistic-lock `version`.
 */

import type { MerchantTerms, MerchantTermsRepository } from "@mayarin/clearing";
import { NotFoundError } from "@mayarin/shared";
import { eq } from "drizzle-orm";
import type { Executor } from "../client.ts";
import { merchants } from "../schema.ts";

export class DrizzleMerchantTermsRepository implements MerchantTermsRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async get(merchantId: string): Promise<MerchantTerms> {
    const [row] = await this.#db
      .select({
        feeBasisPoints: merchants.feeBasisPoints,
        feeMinimum: merchants.feeMinimum,
        maxPaymentSettlement: merchants.maxPaymentSettlement,
        maxDailySettlement: merchants.maxDailySettlement,
      })
      .from(merchants)
      .where(eq(merchants.id, merchantId))
      .limit(1);
    if (row === undefined) throw new NotFoundError("Merchant not found", { merchantId });
    return row;
  }

  async set(merchantId: string, terms: MerchantTerms): Promise<void> {
    const updated = await this.#db
      .update(merchants)
      .set(terms)
      .where(eq(merchants.id, merchantId))
      .returning({ id: merchants.id });
    if (updated.length === 0) throw new NotFoundError("Merchant not found", { merchantId });
  }
}

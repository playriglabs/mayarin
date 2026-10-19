/** Postgres adapters for fraud detection: history counted from intents, the denylist, assessments. */

import type { Denylist, RiskAssessment, RiskHistory } from "@mayarin/fraud";
import type { AssetCode } from "@mayarin/shared";
import { and, count, desc, eq, gte, max, sql } from "drizzle-orm";
import type { Executor } from "../client.ts";
import { addressDenylist, paymentIntents, riskAssessments } from "../schema.ts";

/** Counted from the intents Mayarin already keeps; there is no second copy to drift. */
export class DrizzleRiskHistory implements RiskHistory {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async payerAttempts(payer: string, since: Date): Promise<number> {
    const [row] = await this.#db
      .select({ n: count() })
      .from(paymentIntents)
      .where(
        and(
          eq(sql`lower(${paymentIntents.payerAddress})`, payer.toLowerCase()),
          gte(paymentIntents.createdAt, since),
        ),
      );
    return row?.n ?? 0;
  }

  async merchantAttempts(merchantId: string, since: Date): Promise<number> {
    const [row] = await this.#db
      .select({ n: count() })
      .from(paymentIntents)
      .where(
        and(eq(paymentIntents.ownerMerchantId, merchantId), gte(paymentIntents.createdAt, since)),
      );
    return row?.n ?? 0;
  }

  async merchantPaid(merchantId: string, asset: AssetCode, since: Date) {
    const [row] = await this.#db
      .select({ n: count(), largest: max(paymentIntents.amount) })
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.ownerMerchantId, merchantId),
          eq(paymentIntents.amountAsset, asset),
          eq(paymentIntents.status, "COMPLETED"),
          gte(paymentIntents.createdAt, since),
        ),
      );
    return { count: row?.n ?? 0, largest: BigInt(row?.largest ?? "0") };
  }
}

export class DrizzleDenylist implements Denylist {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async has(address: string): Promise<boolean> {
    const [row] = await this.#db
      .select({ address: addressDenylist.address })
      .from(addressDenylist)
      .where(eq(addressDenylist.address, address.toLowerCase()))
      .limit(1);
    return row !== undefined;
  }

  async add(address: string, reason: string, now: Date): Promise<void> {
    await this.#db
      .insert(addressDenylist)
      .values({ address: address.toLowerCase(), reason, addedAt: now })
      .onConflictDoUpdate({ target: addressDenylist.address, set: { reason } });
  }

  async remove(address: string): Promise<void> {
    await this.#db
      .delete(addressDenylist)
      .where(eq(addressDenylist.address, address.toLowerCase()));
  }
}

export interface StoredRiskAssessment extends RiskAssessment {
  readonly id: string;
}

export class DrizzleRiskAssessments {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async record(id: string, assessment: RiskAssessment): Promise<void> {
    await this.#db.insert(riskAssessments).values({
      id,
      paymentIntentId: assessment.paymentIntentId,
      merchantId: assessment.merchantId,
      payer: assessment.payer?.toLowerCase() ?? null,
      outcome: assessment.outcome,
      signals: [...assessment.signals],
      assessedAt: assessment.assessedAt,
    });
  }

  /** Payments the rules flagged or blocked, newest first. Clear ones are not listed. */
  async listFlagged(merchantId: string, limit = 50): Promise<StoredRiskAssessment[]> {
    const rows = await this.#db
      .select()
      .from(riskAssessments)
      .where(
        and(eq(riskAssessments.merchantId, merchantId), sql`${riskAssessments.outcome} <> 'CLEAR'`),
      )
      .orderBy(desc(riskAssessments.assessedAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      paymentIntentId: row.paymentIntentId,
      merchantId: row.merchantId,
      payer: row.payer ?? undefined,
      outcome: row.outcome as RiskAssessment["outcome"],
      signals: row.signals,
      assessedAt: row.assessedAt,
    }));
  }
}

/**
 * Postgres adapter for `PayoutBatchRepository` (#295).
 */

import type { ChainId } from "@mayarin/chain";
import type { PayoutBatch, PayoutBatchCursor, PayoutBatchRepository } from "@mayarin/payouts";
import { and, desc, eq, lt, or } from "drizzle-orm";
import type { Executor } from "../client.ts";
import { toAsset } from "../mapping.ts";
import { type PayoutBatchRowJson, payoutBatches } from "../schema.ts";

export class DrizzlePayoutBatchRepository implements PayoutBatchRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async insert(batch: PayoutBatch): Promise<PayoutBatch> {
    const [inserted] = await this.#db
      .insert(payoutBatches)
      .values({
        id: batch.id,
        merchantId: batch.merchantId,
        chain: batch.chain,
        sourceAddress: batch.sourceAddress.toLowerCase(),
        submittedBy: batch.submittedBy.toLowerCase(),
        transactionHash: batch.transactionHash.toLowerCase(),
        rows: batch.rows.map(
          (row): PayoutBatchRowJson => ({
            line: row.line,
            to: row.to,
            amount: row.amount.amount.toString(),
            asset: row.amount.asset,
            ...(row.note === undefined ? {} : { note: row.note }),
          }),
        ),
        completedAt: batch.completedAt,
      })
      .onConflictDoNothing({ target: [payoutBatches.chain, payoutBatches.transactionHash] })
      .returning();
    if (inserted !== undefined) return toBatch(inserted);

    const [existing] = await this.#db
      .select()
      .from(payoutBatches)
      .where(
        and(
          eq(payoutBatches.chain, batch.chain),
          eq(payoutBatches.transactionHash, batch.transactionHash.toLowerCase()),
        ),
      )
      .limit(1);
    if (existing === undefined) throw new Error("A payout batch conflicted and then vanished");
    return toBatch(existing);
  }

  async listRecent(
    merchantId: string,
    limit: number,
    cursor?: PayoutBatchCursor,
  ): Promise<readonly PayoutBatch[]> {
    const after =
      cursor === undefined
        ? undefined
        : or(
            lt(payoutBatches.completedAt, cursor.completedAt),
            and(eq(payoutBatches.completedAt, cursor.completedAt), lt(payoutBatches.id, cursor.id)),
          );
    const rows = await this.#db
      .select()
      .from(payoutBatches)
      .where(and(eq(payoutBatches.merchantId, merchantId), after))
      .orderBy(desc(payoutBatches.completedAt), desc(payoutBatches.id))
      .limit(limit);
    return rows.map(toBatch);
  }
}

function toBatch(row: typeof payoutBatches.$inferSelect): PayoutBatch {
  return {
    id: row.id,
    merchantId: row.merchantId,
    chain: row.chain as ChainId,
    sourceAddress: row.sourceAddress,
    submittedBy: row.submittedBy,
    transactionHash: row.transactionHash,
    rows: row.rows.map((entry) => ({
      line: entry.line,
      to: entry.to,
      amount: { amount: BigInt(entry.amount), asset: toAsset(entry.asset) },
      ...(entry.note === undefined ? {} : { note: entry.note }),
    })),
    completedAt: row.completedAt,
  };
}

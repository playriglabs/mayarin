/**
 * The reference in-memory `PayoutBatchRepository`, for tests.
 */

import type { PayoutBatchCursor, PayoutBatchRepository } from "../src/repository.ts";
import type { PayoutBatch } from "../src/types.ts";

export class InMemoryPayoutBatchRepository implements PayoutBatchRepository {
  readonly #batches: PayoutBatch[] = [];

  async insert(batch: PayoutBatch): Promise<PayoutBatch> {
    const existing = this.#batches.find(
      (row) => row.chain === batch.chain && row.transactionHash === batch.transactionHash,
    );
    if (existing !== undefined) return existing;
    this.#batches.push(batch);
    return batch;
  }

  async listRecent(
    merchantId: string,
    limit: number,
    cursor?: PayoutBatchCursor,
  ): Promise<readonly PayoutBatch[]> {
    return this.#batches
      .filter((batch) => batch.merchantId === merchantId)
      .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime() || b.id.localeCompare(a.id))
      .filter(
        (batch) =>
          cursor === undefined ||
          batch.completedAt.getTime() < cursor.completedAt.getTime() ||
          (batch.completedAt.getTime() === cursor.completedAt.getTime() && batch.id < cursor.id),
      )
      .slice(0, limit);
  }
}

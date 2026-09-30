import type { PayoutBatch } from "./types.ts";

/** Where a page of history resumes: the last batch the caller already saw. */
export interface PayoutBatchCursor {
  readonly id: string;
  readonly completedAt: Date;
}

export interface PayoutBatchRepository {
  /**
   * Records a confirmed batch. A second insert for the same transaction hash is
   * a no-op returning the batch already there, so a merchant who clicks
   * "record" twice does not record one payment as two.
   */
  insert(batch: PayoutBatch): Promise<PayoutBatch>;
  /** Newest first. Ask for one more row than a page holds to learn there is a next page. */
  listRecent(
    merchantId: string,
    limit: number,
    cursor?: PayoutBatchCursor,
  ): Promise<readonly PayoutBatch[]>;
}

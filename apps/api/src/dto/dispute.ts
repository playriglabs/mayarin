/**
 * Wire shape of an escrow dispute for the merchant API (#313).
 *
 * The same case file the dashboard shows: who opened it, the deadline, the
 * thread, and how it ended. Times are ISO-8601; addresses are lower-case.
 */

import { z } from "zod";
import type { DisputeMessageDto } from "./escrow.ts";

export type DisputeStatus = "open" | "released" | "refunded" | "split";

export interface DisputeDto {
  readonly id: string;
  /** The number a person quotes, e.g. 93129301239. */
  readonly reference: string;
  readonly paymentIntentId: string;
  /** `open` until the chain decides it; then how the funds moved. */
  readonly status: DisputeStatus;
  readonly chain: string;
  /** The wallet that paid, and that a refund returns to. */
  readonly payer: string;
  /** After this a dispute nobody decided refunds the payer. */
  readonly resolveBy: string;
  readonly openedAt: string;
  readonly decidedAt: string | null;
}

export interface DisputeCaseDto extends DisputeDto {
  /** The thread, oldest first. */
  readonly messages: readonly DisputeMessageDto[];
}

export interface DisputeListDto {
  readonly disputes: readonly DisputeDto[];
  /** How many of the merchant's disputes are open, whatever the filter. */
  readonly open: number;
}

/** `POST /v1/disputes/:id/messages`. */
export const merchantDisputeMessageSchema = z.object({ body: z.string() });

export const disputeListQuerySchema = z.object({
  status: z.enum(["open", "released", "refunded", "split"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * Event log DTOs — the merchant timeline wire shape.
 *
 * One row maps straight off `MerchantEventRow`. No money, no state machine: the
 * timeline shows what happened and when, and links into the payment for the
 * detail. `intentId` is `null` on the wire (not omitted) when a row carries no
 * payment — a webhook delivery in v1, before the `eventId → intent` join is
 * wired.
 */

import type { MerchantEventRow } from "@mayarin/compliance";

export interface MerchantEventDto {
  readonly kind: MerchantEventRow["kind"];
  readonly occurredAt: string;
  readonly merchantId: string;
  readonly intentId: string | null;
  readonly summary: string;
  readonly severity: MerchantEventRow["severity"];
}

export interface EventLogListResponse {
  readonly events: readonly MerchantEventDto[];
}

export function toEventDto(row: MerchantEventRow): MerchantEventDto {
  const { intentId } = row;
  return {
    kind: row.kind,
    occurredAt: row.occurredAt.toISOString(),
    merchantId: row.merchantId,
    intentId: intentId === undefined ? null : intentId,
    summary: row.summary,
    severity: row.severity,
  };
}

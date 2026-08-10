/**
 * Event log wire types, mirrored from the dashboard API DTOs.
 *
 * One timeline row: what happened, when, for which payment (when reachable),
 * and how loudly to surface it. `intentId` is `null` when a row carries no
 * payment — a webhook delivery in v1.
 */

export type EventKind = "clearing" | "settlement" | "webhook";

export type EventSeverity = "info" | "success" | "warning" | "error";

export interface MerchantEventDto {
  readonly kind: EventKind;
  readonly occurredAt: string;
  readonly merchantId: string;
  readonly intentId: string | null;
  readonly summary: string;
  readonly severity: EventSeverity;
}

export interface EventLogListResponse {
  readonly events: readonly MerchantEventDto[];
}

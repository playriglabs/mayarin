/**
 * Order wire types, mirrored from the dashboard API DTOs.
 *
 * An order is the commerce view of a payment intent: the same record the
 * payments surface reads, shown with its line items and the customer it was
 * taken for. Read-only — the dashboard writes payments through links, not here.
 */

import type { MoneyDto } from "@/types/payment";

export interface OrderLineDto {
  /** Present when the line came from a catalog product. */
  readonly productId?: string;
  readonly name: string;
  readonly unitPrice: MoneyDto;
  readonly quantity: number;
}

export interface OrderCustomerDto {
  readonly id: string;
  readonly name: string;
}

export interface OrderDto {
  readonly id: string;
  readonly paymentIntentId: string;
  readonly merchantReference: string | null;
  readonly status: string;
  readonly total: MoneyDto;
  readonly lines: readonly OrderLineDto[];
  readonly customer: OrderCustomerDto | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export interface OrderListResponse {
  readonly orders: readonly OrderDto[];
}

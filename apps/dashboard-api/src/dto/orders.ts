/**
 * Order DTOs — the dashboard's commerce view of a payment.
 *
 * An order is a payment that carries line items (a `metadata.cart` snapshot)
 * or a merchant reference. It is the same `PaymentIntent` the payments surface
 * reads, presented for commerce: lines and the customer rather than the clearing
 * rail. Money maps through `./money.ts` like every other surface.
 */

import type { OrderRow } from "../services/order-read-service.ts";
import { type MoneyDto, toMoneyDto } from "./money.ts";

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

export function toOrderDto(row: OrderRow): OrderDto {
  return {
    id: row.intent.id,
    paymentIntentId: row.intent.id,
    merchantReference: row.intent.merchantReference ?? null,
    status: row.intent.status,
    total: toMoneyDto(row.total),
    lines: row.lines.map((line) => ({
      ...(line.productId === undefined ? {} : { productId: line.productId }),
      name: line.name,
      unitPrice: toMoneyDto(line.unitPrice),
      quantity: line.quantity,
    })),
    customer: row.customer === undefined ? null : { id: row.customer.id, name: row.customer.name },
    createdAt: row.intent.createdAt.toISOString(),
    completedAt: row.intent.completedAt?.toISOString() ?? null,
  };
}

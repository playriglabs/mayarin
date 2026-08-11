/**
 * Customer wire types, mirrored from the dashboard API DTOs.
 *
 * The merchant-managed directory. A customer links to payments through
 * `metadata.customerId`, stamped at intent creation; `CustomerDetailResponse`
 * reads that link back as the customer's orders and completed volume.
 */

import type { OrderDto } from "@/types/orders";
import type { MoneyDto } from "@/types/payment";

export interface CustomerDto {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface CustomerListResponse {
  readonly customers: readonly CustomerDto[];
}

export interface CustomerListFilter {
  readonly limit?: number;
  readonly q?: string;
  readonly sort?: "created" | "-created";
  readonly from?: string;
  readonly to?: string;
}

export interface CustomerDetailResponse {
  readonly customer: CustomerDto;
  /** Completed order volume, in the currency of the first completed order. */
  readonly lifetimeValue: MoneyDto | null;
  readonly orders: readonly OrderDto[];
}

export interface CreateCustomerRequest {
  readonly name: string;
  readonly email?: string;
  readonly notes?: string;
}

export interface UpdateCustomerRequest {
  readonly name?: string;
  /** `null` clears, an absent field leaves it alone. */
  readonly email?: string | null;
  readonly notes?: string | null;
}

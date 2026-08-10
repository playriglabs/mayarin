/**
 * Customers API — the merchant-managed directory over `/customers`. Mirrors
 * the dashboard API route. Returns `Effect`s; the centralized client attaches
 * the CSRF token for mutating calls.
 */

import type { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
import type {
  CreateCustomerRequest,
  CustomerDetailResponse,
  CustomerDto,
  CustomerListResponse,
  UpdateCustomerRequest,
} from "@/types/customers";

export const customersApi = {
  list: (limit?: number): Effect.Effect<CustomerListResponse, ApiError> =>
    request<CustomerListResponse>(limit === undefined ? "/customers" : `/customers?limit=${limit}`),

  detail: (id: string): Effect.Effect<CustomerDetailResponse, ApiError> =>
    request<CustomerDetailResponse>(`/customers/${encodeURIComponent(id)}`),

  create: (body: CreateCustomerRequest): Effect.Effect<CustomerDto, ApiError> =>
    request<CustomerDto>("/customers", { method: "POST", body }),

  update: (id: string, body: UpdateCustomerRequest): Effect.Effect<CustomerDto, ApiError> =>
    request<CustomerDto>(`/customers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
    }),

  remove: (id: string): Effect.Effect<void, ApiError> =>
    request<void>(`/customers/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

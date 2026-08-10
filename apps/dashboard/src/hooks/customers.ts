/**
 * Customer hooks — one React Query hook per `/customers` route. Mirrors
 * `lib/api/customers` one-to-one.
 *
 * Every mutation names the list it invalidates, so a created or edited customer
 * appears in the table without the component knowing how the table loads. The
 * detail view invalidates on its own mutations so its lifetime value and orders
 * refresh after a name change.
 */

import type { ApiError } from "@/lib/api/client";
import { customersApi } from "@/lib/api/customers";
import { useEffectMutation, useEffectQuery } from "@/lib/query";
import type {
  CreateCustomerRequest,
  CustomerDetailResponse,
  CustomerDto,
  CustomerListResponse,
  UpdateCustomerRequest,
} from "@/types/customers";

const CUSTOMERS_KEY = ["customers", "list"];
const customerDetailKey = (id: string) => ["customers", "detail", id] as const;

/** GET `/customers` — the merchant's own directory. */
export function useCustomers() {
  return useEffectQuery<CustomerListResponse, ApiError>({
    queryKey: CUSTOMERS_KEY,
    query: () => customersApi.list(),
  });
}

/** GET `/customers/:id` — the customer, their orders, and lifetime value. */
export function useCustomerDetail(id: string) {
  return useEffectQuery<CustomerDetailResponse, ApiError>({
    queryKey: customerDetailKey(id),
    query: () => customersApi.detail(id),
  });
}

export function useCreateCustomer() {
  return useEffectMutation<CustomerDto, CreateCustomerRequest, ApiError>({
    mutation: (body) => customersApi.create(body),
    invalidate: [CUSTOMERS_KEY],
  });
}

export interface UpdateCustomerVars {
  readonly id: string;
  readonly patch: UpdateCustomerRequest;
}

export function useUpdateCustomer() {
  return useEffectMutation<CustomerDto, UpdateCustomerVars, ApiError>({
    mutation: ({ id, patch }) => customersApi.update(id, patch),
    invalidate: [CUSTOMERS_KEY],
  });
}

export function useDeleteCustomer() {
  return useEffectMutation<void, string, ApiError>({
    mutation: (id) => customersApi.remove(id),
    invalidate: [CUSTOMERS_KEY],
  });
}

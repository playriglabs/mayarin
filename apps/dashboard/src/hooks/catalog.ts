/**
 * Commerce hooks — one React Query hook per `/catalog/*` and `/payment-links`
 * route. Mirrors `lib/api/catalog` one-to-one.
 *
 * Every mutation names the list it invalidates, so a created product or link
 * appears in the table without the component knowing how the table loads.
 */

import { catalogApi, linksApi } from "@/lib/api/catalog";
import type { ApiError } from "@/lib/api/client";
import { useEffectMutation, useEffectQuery } from "@/lib/query";
import type {
  ChargeLinkRequest,
  ChargeLinkResponse,
  CreateLinkRequest,
  CreateProductRequest,
  PaymentLinkListResponse,
  PaymentLinkResponse,
  ProductListResponse,
  ProductResponse,
  QuoteRequest,
  QuoteResponse,
  UpdateProductRequest,
} from "@/types/catalog";

const PRODUCTS_KEY = ["catalog", "products"];
const LINKS_KEY = ["payment-links", "list"];

/** GET `/catalog/products` — the caller's own products. */
export function useProducts() {
  return useEffectQuery<ProductListResponse, ApiError>({
    queryKey: PRODUCTS_KEY,
    query: () => catalogApi.listProducts(),
  });
}

export function useCreateProduct() {
  return useEffectMutation<ProductResponse, CreateProductRequest, ApiError>({
    mutation: (body) => catalogApi.createProduct(body),
    invalidate: [PRODUCTS_KEY],
  });
}

export interface UpdateProductVars {
  readonly id: string;
  readonly patch: UpdateProductRequest;
}

export function useUpdateProduct() {
  return useEffectMutation<ProductResponse, UpdateProductVars, ApiError>({
    mutation: ({ id, patch }) => catalogApi.updateProduct(id, patch),
    invalidate: [PRODUCTS_KEY],
  });
}

/** GET `/payment-links` — every link this merchant has minted. */
export function usePaymentLinks() {
  return useEffectQuery<PaymentLinkListResponse, ApiError>({
    queryKey: LINKS_KEY,
    query: () => linksApi.list(),
  });
}

export function useCreateLink() {
  return useEffectMutation<PaymentLinkResponse, CreateLinkRequest, ApiError>({
    mutation: (body) => linksApi.create(body),
    invalidate: [LINKS_KEY],
  });
}

/**
 * What each accepted asset would take.
 *
 * A mutation rather than a query because it is a POST that prices an amount the
 * counter has just typed, and because caching an indicative rate is how a
 * customer gets shown a number that expired two minutes ago.
 */
export function useQuoteLink() {
  return useEffectMutation<QuoteResponse, QuoteRequest, ApiError>({
    mutation: (body) => linksApi.quote(body),
  });
}

/**
 * Takes one payment at the counter.
 *
 * Invalidates the payments list too: the sale that just started belongs there
 * immediately, not on the merchant's next reload.
 */
export function useChargeLink() {
  return useEffectMutation<ChargeLinkResponse, ChargeLinkRequest, ApiError>({
    mutation: (body) => linksApi.charge(body),
    invalidate: [["payments"]],
  });
}

/** Retires a link. Payments already minted from it are untouched. */
export function useDisableLink() {
  return useEffectMutation<PaymentLinkResponse, string, ApiError>({
    mutation: (id) => linksApi.disable(id),
    invalidate: [LINKS_KEY],
  });
}

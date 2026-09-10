/**
 * Commerce API — products and payment links (#15). Mirrors `/catalog/*` and
 * `/payment-links` on the dashboard API. Returns `Effect`s; never calls `fetch`
 * directly. Mutating calls are CSRF-guarded server-side and the centralized
 * client attaches the double-submit token.
 */

import type { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
import { listPath } from "@/lib/api/list-path";
import type {
  ChargeLinkRequest,
  ChargeLinkResponse,
  CreateLinkRequest,
  CreateProductRequest,
  PaymentLinkListResponse,
  PaymentLinkResponse,
  ProductListResponse,
  ProductOptionsResponse,
  ProductResponse,
  QuoteRequest,
  QuoteResponse,
  UpdateLinkRequest,
  UpdateProductRequest,
} from "@/types/catalog";

export const catalogApi = {
  /** GET `/catalog/products` — the caller's own products. */
  listProducts: (limit?: number, cursor?: string): Effect.Effect<ProductListResponse, ApiError> =>
    request<ProductListResponse>(
      listPath("/catalog/products", limit === undefined ? {} : { limit }, cursor),
    ),

  createProduct: (body: CreateProductRequest): Effect.Effect<ProductResponse, ApiError> =>
    request<ProductResponse>("/catalog/products", { method: "POST", body }),

  updateProduct: (
    id: string,
    body: UpdateProductRequest,
  ): Effect.Effect<ProductResponse, ApiError> =>
    request<ProductResponse>(`/catalog/products/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
    }),

  productOptions: (): Effect.Effect<ProductOptionsResponse, ApiError> =>
    request<ProductOptionsResponse>("/catalog/products/options"),
};

export const linksApi = {
  list: (limit?: number, cursor?: string): Effect.Effect<PaymentLinkListResponse, ApiError> =>
    request<PaymentLinkListResponse>(
      listPath("/payment-links", limit === undefined ? {} : { limit }, cursor),
    ),

  create: (body: CreateLinkRequest): Effect.Effect<PaymentLinkResponse, ApiError> =>
    request<PaymentLinkResponse>("/payment-links", { method: "POST", body }),

  update: (id: string, body: UpdateLinkRequest): Effect.Effect<PaymentLinkResponse, ApiError> =>
    request<PaymentLinkResponse>(`/payment-links/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
    }),

  /** What each accepted asset would take. Indicative — nothing is locked. */
  quote: ({ linkId, ...body }: QuoteRequest): Effect.Effect<QuoteResponse, ApiError> =>
    request<QuoteResponse>(`/payment-links/${encodeURIComponent(linkId)}/quote`, {
      method: "POST",
      body,
    }),

  /**
   * Takes one payment at the counter: mints it from this link and prices it,
   * so a deposit address exists to put in front of the payer.
   */
  charge: ({ linkId, ...body }: ChargeLinkRequest): Effect.Effect<ChargeLinkResponse, ApiError> =>
    request<ChargeLinkResponse>(`/payment-links/${encodeURIComponent(linkId)}/charge`, {
      method: "POST",
      body,
    }),

  /** Retires a link. Payments already minted from it are untouched. */
  disable: (id: string): Effect.Effect<PaymentLinkResponse, ApiError> =>
    request<PaymentLinkResponse>(`/payment-links/${encodeURIComponent(id)}/disable`, {
      method: "POST",
    }),
};

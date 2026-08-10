/**
 * Commerce API — products and payment links (#15). Mirrors `/catalog/*` and
 * `/payment-links` on the dashboard API. Returns `Effect`s; never calls `fetch`
 * directly. Mutating calls are CSRF-guarded server-side and the centralized
 * client attaches the double-submit token.
 */

import type { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
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

export const catalogApi = {
  /** GET `/catalog/products` — the caller's own products. */
  listProducts: (): Effect.Effect<ProductListResponse, ApiError> =>
    request<ProductListResponse>("/catalog/products"),

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
};

export const linksApi = {
  list: (): Effect.Effect<PaymentLinkListResponse, ApiError> =>
    request<PaymentLinkListResponse>("/payment-links"),

  create: (body: CreateLinkRequest): Effect.Effect<PaymentLinkResponse, ApiError> =>
    request<PaymentLinkResponse>("/payment-links", { method: "POST", body }),

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

import type { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
import type {
  CreateInvoiceRequest,
  InvoiceEmailResponse,
  InvoiceListResponse,
  InvoiceResponse,
  IssueInvoiceRequest,
} from "@/types/invoices";

export const invoicesApi = {
  list: (): Effect.Effect<InvoiceListResponse, ApiError> =>
    request<InvoiceListResponse>("/invoices"),

  create: (body: CreateInvoiceRequest): Effect.Effect<InvoiceResponse, ApiError> =>
    request<InvoiceResponse>("/invoices", { method: "POST", body }),

  issue: ({ id, dueAt }: IssueInvoiceRequest): Effect.Effect<InvoiceResponse, ApiError> =>
    request<InvoiceResponse>(`/invoices/${encodeURIComponent(id)}/issue`, {
      method: "POST",
      body: { dueAt },
    }),

  send: (id: string): Effect.Effect<InvoiceEmailResponse, ApiError> =>
    request<InvoiceEmailResponse>(`/invoices/${encodeURIComponent(id)}/send`, {
      method: "POST",
      body: { deliveryId: crypto.randomUUID() },
    }),

  void: (id: string): Effect.Effect<InvoiceResponse, ApiError> =>
    request<InvoiceResponse>(`/invoices/${encodeURIComponent(id)}/void`, {
      method: "POST",
    }),
};

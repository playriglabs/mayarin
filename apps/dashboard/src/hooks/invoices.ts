import type { ApiError } from "@/lib/api/client";
import { invoicesApi } from "@/lib/api/invoices";
import { useEffectMutation, useEffectQuery } from "@/lib/query";
import type {
  CreateInvoiceRequest,
  InvoiceEmailResponse,
  InvoiceListResponse,
  InvoiceResponse,
  IssueInvoiceRequest,
} from "@/types/invoices";

const INVOICES_KEY = ["invoices"];
const LIVE_STATUSES = new Set(["issued", "partially_paid", "overdue"]);

export function useInvoices() {
  return useEffectQuery<InvoiceListResponse, ApiError>({
    queryKey: INVOICES_KEY,
    query: invoicesApi.list,
    refetchInterval: (data) =>
      (data?.invoices ?? []).some((invoice) => LIVE_STATUSES.has(invoice.status)) ? 10_000 : false,
  });
}

export function useCreateInvoice() {
  return useEffectMutation<InvoiceResponse, CreateInvoiceRequest, ApiError>({
    mutation: invoicesApi.create,
    toast: { loading: "Generating invoice…", success: "Invoice ready to send" },
    invalidate: [INVOICES_KEY],
  });
}

export function useIssueInvoice() {
  return useEffectMutation<InvoiceResponse, IssueInvoiceRequest, ApiError>({
    mutation: invoicesApi.issue,
    toast: { loading: "Issuing invoice…", success: "Invoice issued" },
    invalidate: [INVOICES_KEY],
  });
}

export function useSendInvoiceEmail() {
  return useEffectMutation<InvoiceEmailResponse, string, ApiError>({
    mutation: invoicesApi.send,
    toast: { loading: "Sending invoice…", success: "Invoice email sent" },
  });
}

export function useVoidInvoice() {
  return useEffectMutation<InvoiceResponse, string, ApiError>({
    mutation: invoicesApi.void,
    toast: { loading: "Voiding invoice…", success: "Invoice voided" },
    invalidate: [INVOICES_KEY],
  });
}

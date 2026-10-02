/** Escrow dispute hooks (#313): the merchant's answer and the arbiter's console. */

import type { ApiError } from "@/lib/api/client";
import { disputesApi } from "@/lib/api/disputes";
import { paymentsApi } from "@/lib/api/payments";
import { useEffectMutation, useEffectQuery } from "@/lib/query";
import type { DisputeCaseDto, DisputeDto, DisputeMessageDto } from "@/types/payment";

type Posted = { message: DisputeMessageDto };

/** The merchant's message in a dispute over payment `id`. */
export function useMerchantDisputeMessage(id: string) {
  return useEffectMutation<Posted, string, ApiError>({
    mutation: (body) => paymentsApi.disputeMessage(id, body),
    toast: { loading: "Sending…", success: "Sent to the arbiter" },
    invalidate: [["payments", "escrow", id]],
  });
}

export function useDisputes() {
  return useEffectQuery<{ disputes: readonly DisputeDto[] }, ApiError>({
    queryKey: ["disputes", "list"],
    query: () => disputesApi.list(),
  });
}

export function useDisputeCase(id: string) {
  return useEffectQuery<DisputeCaseDto, ApiError>({
    queryKey: ["disputes", "case", id],
    query: () => disputesApi.get(id),
  });
}

export function useArbiterMessage(id: string) {
  return useEffectMutation<Posted, string, ApiError>({
    mutation: (body) => disputesApi.message(id, body),
    toast: { loading: "Sending…", success: "Message posted" },
    invalidate: [["disputes", "case", id]],
  });
}

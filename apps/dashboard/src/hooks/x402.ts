/** x402 resource hooks — one per `/x402-resources` route (#208). */

import type { ApiError } from "@/lib/api/client";
import { x402Api } from "@/lib/api/x402";
import { useEffectMutation, useEffectQuery } from "@/lib/query";
import type {
  CreateX402ResourceRequest,
  X402RailsResponse,
  X402ResourceListResponse,
  X402ResourceResponse,
} from "@/types/x402";

const RESOURCES_KEY = ["x402-resources", "list"];
const RAILS_KEY = ["x402-resources", "rails"];

export function useX402Resources() {
  return useEffectQuery<X402ResourceListResponse, ApiError>({
    queryKey: RESOURCES_KEY,
    query: () => x402Api.list(),
  });
}

/** Where this merchant can be paid. An empty list is the answer, not an error. */
export function useX402Rails() {
  return useEffectQuery<X402RailsResponse, ApiError>({
    queryKey: RAILS_KEY,
    query: () => x402Api.rails(),
  });
}

export function useCreateX402Resource() {
  return useEffectMutation<X402ResourceResponse, CreateX402ResourceRequest, ApiError>({
    mutation: (body) => x402Api.create(body),
    toast: { loading: "Registering endpoint…", success: "Endpoint registered" },
    invalidate: [RESOURCES_KEY],
  });
}

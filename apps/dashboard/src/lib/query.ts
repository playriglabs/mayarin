/**
 * React Query setup and Effect-aware hooks.
 *
 * A single shared `QueryClient` so every island sees the same cache. The two
 * hooks run `Effect`s through `runEffect`, keeping the Effect/React-Query
 * boundary in one place — components never call `Effect.runPromise` or `fetch`.
 */

import { QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import type { Effect } from "effect";
import { runEffect } from "./run";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

export interface EffectQueryOptions<T, E> {
  readonly queryKey: readonly unknown[];
  readonly query: () => Effect.Effect<T, E>;
  readonly enabled?: boolean;
}

/** `useQuery` over an `Effect`-returning fetcher. */
export function useEffectQuery<T, E>(options: EffectQueryOptions<T, E>) {
  return useQuery({
    queryKey: options.queryKey,
    queryFn: () => runEffect(options.query()),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  });
}

export interface EffectMutationOptions<T, V, E> {
  readonly mutation: (vars: V) => Effect.Effect<T, E>;
}

/** `useMutation` over an `Effect`-returning mutation. */
export function useEffectMutation<T, V, E>(options: EffectMutationOptions<T, V, E>) {
  return useMutation({
    mutationFn: (vars: V) => runEffect(options.mutation(vars)),
  });
}

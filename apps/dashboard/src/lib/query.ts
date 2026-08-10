/**
 * React Query setup and Effect-aware hooks.
 *
 * A single shared `QueryClient` so every island sees the same cache. The two
 * hooks run `Effect`s through `runEffect`, keeping the Effect/React-Query
 * boundary in one place — components never call `Effect.runPromise` or `fetch`.
 */

import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  /**
   * Milliseconds between background refetches, or `false` for none.
   *
   * What makes a payment that is still clearing update itself. The function
   * form takes the current data — `undefined` before the first load — so a list
   * can stop polling once nothing in it can still move. Polling forever costs
   * the merchant nothing and the server everything.
   */
  readonly refetchInterval?: number | false | ((data: T | undefined) => number | false);
}

/** `useQuery` over an `Effect`-returning fetcher. */
export function useEffectQuery<T, E>(options: EffectQueryOptions<T, E>) {
  const interval = options.refetchInterval;

  return useQuery({
    queryKey: options.queryKey,
    queryFn: () => runEffect(options.query()),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
    // Adapted rather than passed through: React Query hands the callback its
    // whole `Query` object, and a hook caller has no business knowing that
    // shape when the only thing they decide from is the data.
    ...(interval === undefined
      ? {}
      : {
          refetchInterval:
            typeof interval === "function"
              ? (query: { state: { data: T | undefined } }) => interval(query.state.data)
              : interval,
        }),
  });
}

export interface EffectMutationOptions<T, V, E> {
  readonly mutation: (vars: V) => Effect.Effect<T, E>;
  /**
   * Query keys to invalidate after a success.
   *
   * Here rather than at each call site: a component that creates a product
   * should not also have to know which cache key the table it appears in reads
   * from, and the one that forgets is the one with the stale table.
   */
  readonly invalidate?: readonly (readonly unknown[])[];
}

/** `useMutation` over an `Effect`-returning mutation. */
export function useEffectMutation<T, V, E>(options: EffectMutationOptions<T, V, E>) {
  const client = useQueryClient();
  const invalidate = options.invalidate;

  return useMutation({
    mutationFn: (vars: V) => runEffect(options.mutation(vars)),
    ...(invalidate === undefined
      ? {}
      : {
          onSuccess: async () => {
            await Promise.all(invalidate.map((queryKey) => client.invalidateQueries({ queryKey })));
          },
        }),
  });
}

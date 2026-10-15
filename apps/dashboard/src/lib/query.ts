/**
 * React Query setup and Effect-aware hooks.
 *
 * A single shared `QueryClient` so every island sees the same cache. The two
 * hooks run `Effect`s through `runEffect`, keeping the Effect/React-Query
 * boundary in one place — components never call `Effect.runPromise` or `fetch`.
 */

import {
  keepPreviousData,
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Effect } from "effect";
import { toast } from "sonner";
import { onStepUp } from "./mfa-step-up";
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
  /**
   * Keep showing the last data while a new key loads.
   *
   * For a paginated list: the next page is a new key, and without this the
   * whole view drops back to its skeleton between pages.
   */
  readonly keepPrevious?: boolean;
}

/** `useQuery` over an `Effect`-returning fetcher. */
export function useEffectQuery<T, E>(options: EffectQueryOptions<T, E>) {
  const interval = options.refetchInterval;

  return useQuery({
    queryKey: options.queryKey,
    queryFn: () => runEffect(options.query()),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
    ...(options.keepPrevious === true ? { placeholderData: keepPreviousData } : {}),
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
  /** User-facing lifecycle copy. Omit for mutations, such as auth, that use inline feedback. */
  readonly toast?: {
    readonly loading: string;
    readonly success: string;
  };
  /**
   * Query keys to invalidate after a success.
   *
   * Here rather than at each call site: a component that creates a product
   * should not also have to know which cache key the table it appears in reads
   * from, and the one that forgets is the one with the stale table.
   */
  readonly invalidate?: readonly (readonly unknown[])[];
}

/** How long a request may run before it is worth a "working…" toast. */
const PROGRESS_DELAY_MS = 250;

/**
 * Progress for a mutation, kept off screen while a step-up code is being asked
 * for (SEC-16): "Submitting withdrawal…" over a dialog that is still waiting
 * for the person says something that has not happened yet. The toast appears
 * once the request is really under way, and returns after the code is entered.
 */
function showProgress(
  feedback: { readonly loading: string; readonly success: string },
  settled: Promise<unknown>,
): void {
  const id = `mutation-${Math.random().toString(36).slice(2)}`;
  const show = () => toast.loading(feedback.loading, { id });
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(show, PROGRESS_DELAY_MS);
  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const unsubscribe = onStepUp((event) => {
    if (event === "asking") {
      stop();
      toast.dismiss(id);
    } else if (event === "answered") {
      show();
    }
  });

  settled
    .then(
      () => toast.success(feedback.success, { id }),
      (error: unknown) => {
        // Declining the code is a choice, not a failure worth a toast.
        const declined =
          typeof error === "object" &&
          error !== null &&
          "reason" in error &&
          error.reason === "mfa_code_required";
        if (declined) {
          toast.dismiss(id);
          return;
        }
        toast.error(
          error instanceof Error ? error.message : "Something went wrong. Please try again.",
          { id },
        );
      },
    )
    .finally(() => {
      stop();
      unsubscribe();
    });
}

/** `useMutation` over an `Effect`-returning mutation. */
export function useEffectMutation<T, V, E>(options: EffectMutationOptions<T, V, E>) {
  const client = useQueryClient();
  const invalidate = options.invalidate;

  return useMutation({
    mutationFn: (vars: V) => {
      const promise = runEffect(options.mutation(vars)).then(async (result) => {
        if (invalidate !== undefined) {
          await Promise.all(invalidate.map((queryKey) => client.invalidateQueries({ queryKey })));
        }
        return result;
      });
      const feedback = options.toast;

      if (feedback === undefined) return promise;

      showProgress(feedback, promise);
      return promise;
    },
  });
}

/**
 * Effect → Promise boundary.
 *
 * React Query works in `Promise`s, not `Effect`s, so every query/mutation runs
 * its `Effect` through here. `runPromiseExit` returns an `Exit` (no throw), and a
 * `Fail` cause carrying our `ApiError` is thrown as that `ApiError` — so React
 * Query's `error` is the typed `ApiError`, not a `FiberFailure` wrapper.
 */

import { Cause, Effect, Exit, Option } from "effect";

export async function runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;

  // A typed failure (`Fail`) carries the domain error — throw it directly.
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) throw failure.value;

  // A defect (unexpected) — surface the cause; React Query treats it as an error.
  throw exit.cause;
}

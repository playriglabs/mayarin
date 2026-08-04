/**
 * Effect running helpers.
 *
 * `Effect.runPromise` rejects with a `FiberFailure` wrapper, which hides the
 * typed error from `isMayarinError`. Running through `Effect.either` folds the
 * typed error channel into a `Left` in the success channel, so there is no
 * wrapper to unwrap — the `MayarinError` surfaces directly for the error handler.
 */

import { isMayarinError } from "@mayarin/shared";
import { Effect } from "effect";

/**
 * Runs an `Effect` and throws its typed error on failure, so a route can `await`
 * it and let the error handler map the `MayarinError`. Defects (which we never
 * produce) still reject `runPromise` normally.
 */
export async function runEffect<A, E>(io: Effect.Effect<A, E>): Promise<A> {
  const either = await Effect.runPromise(Effect.either(io));
  if (either._tag === "Right") return either.right;
  throw either.left;
}

/**
 * Runs an `Effect` whose only expected failure is an `UNAUTHORIZED` Mayarin error.
 * Returns `null` for that case (treat as "no session"); rethrows anything else so
 * the error handler maps it. Used by the session middleware.
 */
export async function runEffectOrUnauthorized<A, E>(io: Effect.Effect<A, E>): Promise<A | null> {
  const either = await Effect.runPromise(Effect.either(io));
  if (either._tag === "Right") return either.right;
  const error = either.left;
  if (isMayarinError(error) && error.code === "UNAUTHORIZED") return null;
  throw error;
}

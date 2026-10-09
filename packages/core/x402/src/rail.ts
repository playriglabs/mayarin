/**
 * Pick the default x402 rail in the order the merchant configured it.
 *
 * There is deliberately no live ranking layer here. Every accepted rail has
 * already passed capability and pricing checks, so the first entry is the
 * clearest deterministic default and a payer may still choose another entry.
 */

import type { ChainId } from "@mayarin/chain";
import { ValidationError } from "@mayarin/shared";

export interface RailChoice {
  readonly chain: ChainId;
  readonly reason: string;
}

export function chooseRail(accepted: readonly ChainId[]): RailChoice {
  const chain = accepted[0];
  if (chain === undefined) {
    throw new ValidationError("chooseRail needs at least one accepted rail", {});
  }

  return {
    chain,
    reason: `${chain}: first accepted rail in merchant configuration`,
  };
}

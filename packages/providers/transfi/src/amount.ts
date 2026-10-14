/**
 * The fiat amount that delivers at least a required stablecoin amount.
 *
 * TransFi prices forward only — fiat in, crypto out — but a deposit-match
 * payment needs a fixed crypto amount to arrive. So this converges on the fiat
 * amount: scale a probe by the shortfall plus a small margin, then verify with a
 * second quote. A fixed network fee makes the rate slightly non-linear, which is
 * why one scale is not trusted and a verification quote always follows.
 *
 * Underpaying is the failure to avoid — the payment would sit short of its
 * required amount — so the result rounds up and carries a margin, and any
 * excess lands in the deposit address as an overpayment.
 */

import { ProviderError } from "@mayarin/shared";

/** Added on top of the scaled amount, so rounding and fee drift do not leave it short. */
const MARGIN = 1.01;
const MAX_ROUNDS = 6;
/** A probe below the fixed network fee quotes nothing; widen it instead of failing. */
const WIDEN = 10;

function roundUp(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.ceil(value * scale) / scale;
}

export interface PricedAmount {
  /** The fiat amount to charge. */
  readonly amount: number;
  /** What that amount delivers, in stablecoin units. */
  readonly delivered: number;
}

export async function fiatAmountFor(args: {
  /** Stablecoin units that must arrive, as a decimal number. */
  readonly required: number;
  /** Any amount inside the payment method's limits, used to read the rate. */
  readonly probe: number;
  /** Minor-unit precision of the fiat currency. */
  readonly decimals: number;
  /**
   * One forward quote. `belowMinimum` is the method's real floor when the amount
   * was refused for being under it — there is no output to scale from, but there
   * is a better place to start than a tenfold guess.
   */
  readonly quote: (
    fiatAmount: number,
  ) => Promise<{ readonly destinationAmount: number; readonly belowMinimum?: number }>;
}): Promise<PricedAmount> {
  let amount = args.probe;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { destinationAmount, belowMinimum } = await args.quote(amount);
    if (round > 0 && destinationAmount >= args.required) {
      return { amount, delivered: destinationAmount };
    }
    if (belowMinimum !== undefined) {
      amount = roundUp(Math.max(belowMinimum, amount), args.decimals);
    } else if (destinationAmount <= 0) {
      amount = roundUp(amount * WIDEN, args.decimals);
    } else {
      amount = roundUp(amount * (args.required / destinationAmount) * MARGIN, args.decimals);
    }
  }

  throw new ProviderError("Could not price the payment in this currency", {
    required: args.required,
  });
}

/**
 * The countdown, as pure arithmetic.
 *
 * A price lock expires, and a payer who sends the asset a minute late has sent
 * funds against a payment that will not accept them — so the remaining time is
 * on screen from first paint, and the last minute changes colour.
 */

export interface Remaining {
  readonly text: string;
  /** Under a minute: the presentation turns warning-coloured. */
  readonly low: boolean;
  readonly expired: boolean;
}

export function remainingAt(expiresAtIso: string, nowMs: number): Remaining {
  const left = new Date(expiresAtIso).getTime() - nowMs;
  if (left <= 0) {
    return { text: "kedaluwarsa", low: false, expired: true };
  }
  const total = Math.floor(left / 1000);
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return { text: `${minutes}:${seconds}`, low: total < 60, expired: false };
}

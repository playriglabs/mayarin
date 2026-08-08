/**
 * Screening port — the seam a KYC/AML vendor plugs into, with nothing plugged in.
 *
 * The RFC is explicit that KYC is a Non-Goal for the crypto-only MVP and that
 * `didit` is a later option. So this is a port and a disabled default, and
 * **nothing in the payment flow calls it.** That is the intended shape: adding a
 * vendor later is writing one adapter in `packages/providers` and naming it in
 * the composition root, not threading a new concept through clearing.
 *
 * Because it gates nothing, turning it on is a deliberate act. A screening port
 * that quietly acquired a caller would turn "no KYC in the MVP" into a claim the
 * code no longer supports.
 */

/** Who is being screened, named by what Mayarin actually holds about them. */
export interface ScreeningSubject {
  readonly merchantId: string;
  /** The payment this screening is about — a clearing transaction id. */
  readonly reference: string;
  /** The payer's on-chain address, when the path exposes one. */
  readonly address?: string;
}

/**
 * `NOT_SCREENED` is a first-class outcome, not an absence.
 *
 * With no provider configured the honest answer is "nobody looked", and that is
 * a different fact from "somebody looked and found nothing". Collapsing the two
 * into `CLEAR` is how an unscreened payment later reads as a cleared one.
 */
export const SCREENING_OUTCOMES = ["CLEAR", "REVIEW", "BLOCKED", "NOT_SCREENED"] as const;

export type ScreeningOutcome = (typeof SCREENING_OUTCOMES)[number];

export interface ScreeningDecision {
  readonly outcome: ScreeningOutcome;
  /** Which provider decided, so a stored decision stays attributable. */
  readonly provider: string;
  readonly reason: string;
  readonly at: Date;
}

export interface ScreeningProvider {
  readonly name: string;
  /** `now` is passed in rather than read, so the domain stays clock-free. */
  screen(subject: ScreeningSubject, now: Date): Promise<ScreeningDecision>;
}

/** The default: no vendor, no network call, and an outcome that says so. */
export const disabledScreening: ScreeningProvider = {
  name: "disabled",
  async screen(_subject: ScreeningSubject, now: Date): Promise<ScreeningDecision> {
    return {
      outcome: "NOT_SCREENED",
      provider: "disabled",
      reason: "No screening provider is configured",
      at: now,
    };
  },
};

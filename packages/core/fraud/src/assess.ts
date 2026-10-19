import type { Clock } from "@mayarin/shared";
import type {
  Denylist,
  RiskAssessment,
  RiskFacts,
  RiskHistory,
  RiskRules,
  RiskSignal,
} from "./types.ts";

export interface RiskAssessorDeps {
  /** A function, not a value: the thresholds are runtime config and change without a restart. */
  readonly rules: () => Promise<RiskRules>;
  readonly history: RiskHistory;
  readonly denylist: Denylist;
  readonly clock: Clock;
}

/**
 * Runs every rule and folds the signals into one outcome: any `block` signal
 * blocks, otherwise any signal is a review, otherwise clear. It never throws on
 * a risk finding; refusing is the caller's decision, because the same finding
 * means "stop" at one gate and "show a flag" at another.
 */
export class RiskAssessor {
  readonly #deps: RiskAssessorDeps;

  constructor(deps: RiskAssessorDeps) {
    this.#deps = deps;
  }

  async assess(facts: RiskFacts): Promise<RiskAssessment> {
    const { history, denylist, clock } = this.#deps;
    const rules = await this.#deps.rules();
    const now = clock.now();
    const since = new Date(now.getTime() - rules.windowSeconds * 1_000);
    const signals: RiskSignal[] = [];

    if (facts.payer !== undefined) {
      if (await denylist.has(facts.payer)) {
        signals.push({
          rule: "denylist",
          action: "block",
          detail: "The paying address is on the denylist",
        });
      }
      if (rules.payerAttempts !== undefined) {
        const count = await history.payerAttempts(facts.payer, since);
        if (count >= rules.payerAttempts) {
          signals.push({
            rule: "payer-velocity",
            action: "review",
            detail: `${count} payments from this address in ${rules.windowSeconds}s`,
          });
        }
      }
    }

    if (rules.merchantAttempts !== undefined) {
      const count = await history.merchantAttempts(facts.merchantId, since);
      if (count >= rules.merchantAttempts) {
        signals.push({
          rule: "merchant-velocity",
          action: "review",
          detail: `${count} payments on this merchant in ${rules.windowSeconds}s`,
        });
      }
    }

    if (rules.spikeFactor !== undefined) {
      const paid = await history.merchantPaid(facts.merchantId, facts.asset, since);
      const enoughHistory = paid.count >= (rules.spikeMinHistory ?? 1);
      if (enoughHistory && facts.amount > paid.largest * BigInt(rules.spikeFactor)) {
        signals.push({
          rule: "amount-spike",
          action: "review",
          detail: `${facts.amount} ${facts.asset} is over ${rules.spikeFactor}x the largest recent payment`,
        });
      }
    }

    const outcome = signals.some((s) => s.action === "block")
      ? "BLOCKED"
      : signals.length > 0
        ? "REVIEW"
        : "CLEAR";
    return {
      paymentIntentId: facts.paymentIntentId,
      merchantId: facts.merchantId,
      payer: facts.payer,
      outcome,
      signals,
      assessedAt: now,
    };
  }
}

/**
 * Payer standing (#314): whether a wallet may still take buyer protection.
 *
 * Read from what already happened — escrowed payments and how their disputes
 * ended — against rules an operator sets at runtime (`disputeStanding`). No
 * table of its own: the record is a count over the escrow and dispute rows,
 * so it cannot drift from them.
 *
 * Only repeat abuse from one address is stopped here; a fresh wallet starts
 * clean. The dispute bond (#315) is what makes abuse costly.
 */

import type { PayerRecord } from "@mayarin/db";
import type { PayerStandingSource } from "@mayarin/payment-intent";
import type { DisputeStandingRules } from "../market.ts";

export type Standing = "good" | "flagged";

export function standingOf(record: PayerRecord, rules: DisputeStandingRules): Standing {
  if (record.lost >= rules.maxLostDisputes) return "flagged";
  if (
    record.escrowed >= rules.minEscrows &&
    record.disputes * 10_000 > record.escrowed * rules.maxDisputeRateBps
  ) {
    return "flagged";
  }
  return "good";
}

export class PayerStanding implements PayerStandingSource {
  readonly #records: { payerRecord(payer: string): Promise<PayerRecord> };
  readonly #rules: () => Promise<DisputeStandingRules>;

  constructor(
    records: { payerRecord(payer: string): Promise<PayerRecord> },
    rules: () => Promise<DisputeStandingRules>,
  ) {
    this.#records = records;
    this.#rules = rules;
  }

  async standing(payer: string): Promise<Standing> {
    const [record, rules] = await Promise.all([this.#records.payerRecord(payer), this.#rules()]);
    return standingOf(record, rules);
  }

  async isFlagged(payer: string): Promise<boolean> {
    return (await this.standing(payer)) === "flagged";
  }
}

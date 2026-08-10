/**
 * Settlement read service (#15).
 *
 * "Where did my money go" for one merchant. A settlement is not a record of its
 * own: it is what clearing made of a payment — the locked settlement amount, the
 * fee, the net — plus, on the contract path, what the chain then reported. This
 * service assembles the two and never writes anything.
 *
 * Reads only the merchant's own intents, so the scope filter is applied once, at
 * the source, and the joins that follow can only reach rows already inside it.
 *
 * Both joins are bulk reads rather than a lookup per payment: a page of fifty
 * payments would otherwise be a hundred round trips to render one table.
 */

import type { SettlementEvent, SettlementEventRepository } from "@mayarin/chain";
import type { ClearingTransaction } from "@mayarin/clearing";
import type { PaymentIntent } from "@mayarin/payment-intent";
import type { Scope } from "../dto/auth.ts";
import type { PaymentReadService } from "./payment-read-service.ts";

/** The slice of `ClearingRepository` this view needs. */
export interface ClearingBulkReadRepository {
  listByPaymentIntentIds(
    paymentIntentIds: readonly string[],
  ): Promise<readonly ClearingTransaction[]>;
}

/** The slice of `SettlementEventRepository` this view needs. */
export type SettlementEventReadRepository = Pick<SettlementEventRepository, "listByIntentIds">;

export interface SettlementReadServiceOptions {
  readonly payments: PaymentReadService;
  readonly clearing: ClearingBulkReadRepository;
  readonly settlements: SettlementEventReadRepository;
}

/** One row of the settlement view: a payment, what clearing booked, what the chain saw. */
export interface SettlementRow {
  readonly intent: PaymentIntent;
  readonly transaction: ClearingTransaction;
  /** Present only on the contract path, and only once the indexer has read the log. */
  readonly event: SettlementEvent | undefined;
}

/**
 * Which of two settlement logs for the same payment is the one to show.
 *
 * One intent id can carry more than one row: the table is unique on
 * `(chain, txHash, logIndex)`, so a settlement that was reorged away and then
 * re-submitted under a new hash leaves both behind. Picking whichever an
 * unordered `SELECT` returned last would make the "reorged" badge — the one
 * signal that exists precisely for this case — appear and disappear between
 * refreshes.
 *
 * The later block wins, and an orphaned row never displaces a live one at the
 * same height: the reorg is visible on the row it happened to, and the
 * settlement that stuck is the settlement reported.
 */
function outranks(candidate: SettlementEvent, held: SettlementEvent): boolean {
  const candidateOrphaned = candidate.orphanedAt !== undefined;
  const heldOrphaned = held.orphanedAt !== undefined;
  if (candidateOrphaned !== heldOrphaned) return heldOrphaned;
  return candidate.blockNumber > held.blockNumber;
}

export class SettlementReadService {
  readonly #payments: PaymentReadService;
  readonly #clearing: ClearingBulkReadRepository;
  readonly #settlements: SettlementEventReadRepository;

  constructor(options: SettlementReadServiceOptions) {
    this.#payments = options.payments;
    this.#clearing = options.clearing;
    this.#settlements = options.settlements;
  }

  /**
   * The caller's own settlements, newest-first.
   *
   * A payment with no clearing transaction is dropped rather than shown with
   * blank amounts: it has not been priced, so there is no settlement to report
   * yet, and a row of dashes in a money table reads as a failure rather than as
   * a payment that has not got there.
   */
  async list(scope: Scope, limit?: number): Promise<readonly SettlementRow[]> {
    const intents = await this.#payments.list(scope, limit);
    if (intents.length === 0) return [];

    const transactions = await this.#clearing.listByPaymentIntentIds(
      intents.map((intent) => intent.id),
    );
    const byIntentId = new Map(transactions.map((tx) => [tx.paymentIntentId, tx]));

    // The chain identifies a settlement by the id the backend signed into the
    // order, which exists only on the contract path.
    const contractIntentIds = transactions
      .map((tx) => tx.contract?.order.intentId)
      .filter((id): id is string => id !== undefined);
    const events = await this.#settlements.listByIntentIds(contractIntentIds);
    const byContractIntentId = new Map<string, SettlementEvent>();
    for (const event of events) {
      const held = byContractIntentId.get(event.intentId);
      if (held === undefined || outranks(event, held))
        byContractIntentId.set(event.intentId, event);
    }

    const rows: SettlementRow[] = [];
    for (const intent of intents) {
      const transaction = byIntentId.get(intent.id);
      if (transaction === undefined) continue;
      const contractIntentId = transaction.contract?.order.intentId;
      rows.push({
        intent,
        transaction,
        event:
          contractIntentId === undefined ? undefined : byContractIntentId.get(contractIntentId),
      });
    }
    return rows;
  }
}

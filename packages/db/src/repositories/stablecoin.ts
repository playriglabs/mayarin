/**
 * Durable store for the internal stablecoin rail (#15).
 *
 * The adapter's own record of what it settled, kept where a restart cannot
 * reach it. The clearing engine settles, persists the `providerReference`, and
 * later asks the adapter what became of it — a question that has to survive the
 * process that answered the first one.
 *
 * Outside `core` like every other adapter, and reached through the port the
 * adapter defines, so the rail stays swappable.
 */

import type { InternalSettlement, InternalSettlementStore } from "@mayarin/provider-stablecoin";
import type { SettlementState } from "@mayarin/settlement";
import { type AssetCode, isAssetCode, ValidationError } from "@mayarin/shared";
import { eq } from "drizzle-orm";
import type { Database } from "../client.ts";
import { stablecoinSettlements } from "../schema.ts";

type Row = typeof stablecoinSettlements.$inferSelect;

export class DrizzleInternalSettlementStore implements InternalSettlementStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Writes the settlement.
   *
   * `onConflictDoNothing` on the idempotency key: two concurrent settles for
   * one payment must leave one record, and the loser reads back the winner's
   * rather than crediting a second time.
   */
  async put(settlement: InternalSettlement, idempotencyKey: string): Promise<void> {
    await this.#db
      .insert(stablecoinSettlements)
      .values({
        providerReference: settlement.providerReference,
        clearingTransactionId: settlement.clearingTransactionId,
        idempotencyKey,
        state: settlement.state,
        amount: settlement.amount.amount.toString(),
        asset: settlement.amount.asset,
        createdAt: settlement.updatedAt,
        updatedAt: settlement.updatedAt,
      })
      .onConflictDoNothing();
  }

  async find(providerReference: string): Promise<InternalSettlement | null> {
    const [row] = await this.#db
      .select()
      .from(stablecoinSettlements)
      .where(eq(stablecoinSettlements.providerReference, providerReference))
      .limit(1);
    return row === undefined ? null : toSettlement(row);
  }

  async findByIdempotencyKey(key: string): Promise<InternalSettlement | null> {
    const [row] = await this.#db
      .select()
      .from(stablecoinSettlements)
      .where(eq(stablecoinSettlements.idempotencyKey, key))
      .limit(1);
    return row === undefined ? null : toSettlement(row);
  }

  async setState(providerReference: string, state: SettlementState, at: Date): Promise<void> {
    await this.#db
      .update(stablecoinSettlements)
      .set({ state, updatedAt: at })
      .where(eq(stablecoinSettlements.providerReference, providerReference));
  }
}

function toSettlement(row: Row): InternalSettlement {
  return {
    providerReference: row.providerReference,
    clearingTransactionId: row.clearingTransactionId,
    state: row.state as SettlementState,
    amount: { amount: BigInt(row.amount), asset: assertAsset(row.asset, row.providerReference) },
    updatedAt: row.updatedAt,
  };
}

/** Postgres stores the code as free text; a code that left the registry must not flow on. */
function assertAsset(value: string, providerReference: string): AssetCode {
  if (!isAssetCode(value)) {
    throw new ValidationError(`Settlement ${providerReference} names an unknown asset "${value}"`, {
      providerReference,
      asset: value,
    });
  }
  return value;
}

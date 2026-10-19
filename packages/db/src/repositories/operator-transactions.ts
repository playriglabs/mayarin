/** Drizzle store for the operator transaction record (SEC-04). */

import type {
  OperatorTransaction,
  OperatorTransactionStatus,
  OperatorTransactionStore,
} from "@mayarin/shared";
import { eq, inArray, sql } from "drizzle-orm";
import type { Executor } from "../client.ts";
import { operatorTransactions } from "../schema.ts";

export class DrizzleOperatorTransactionStore implements OperatorTransactionStore {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async listOpen(): Promise<readonly OperatorTransaction[]> {
    const rows = await this.#db
      .select()
      .from(operatorTransactions)
      .where(inArray(operatorTransactions.status, ["allocated", "submitted"]));
    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      nonce: row.nonce,
      status: row.status as OperatorTransactionStatus,
      ...(row.txHash === null ? {} : { txHash: row.txHash }),
      allocatedAt: row.allocatedAt,
      ...(row.submittedAt === null ? {} : { submittedAt: row.submittedAt }),
      ...(row.toAddress === null || row.data === null || row.value === null
        ? {}
        : { call: { to: row.toAddress, data: row.data, value: BigInt(row.value) } }),
      bumpCount: row.bumpCount,
    }));
  }

  async resolve(id: string, status: OperatorTransactionStatus, at: Date): Promise<void> {
    await this.#db
      .update(operatorTransactions)
      .set({ status, resolvedAt: at })
      .where(eq(operatorTransactions.id, id));
  }

  async recordBump(id: string, txHash: string, at: Date): Promise<void> {
    await this.#db
      .update(operatorTransactions)
      .set({ txHash, submittedAt: at, bumpCount: sql`${operatorTransactions.bumpCount} + 1` })
      .where(eq(operatorTransactions.id, id));
  }
}

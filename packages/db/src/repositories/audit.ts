/**
 * Postgres adapter for the audit query port (RFC #16).
 *
 * A projection over `clearing_transactions`, not a table of its own. The audit
 * trail is the records the system already keeps; storing a second copy for
 * compliance would create the one thing a compliance surface must not have — a
 * version of the truth that can drift from the truth.
 *
 * The merchant/time index added alongside this is what keeps the scan bounded;
 * without it the query degrades to a full table scan as history grows.
 */

import type { ClearingState } from "@mayarin/clearing";
import type {
  AuditFilter,
  AuditQueryRepository,
  MerchantEventRepository,
  MerchantEventRow,
  MerchantEventSeverity,
  PaymentAuditSummary,
} from "@mayarin/compliance";
import { and, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import type { Executor } from "../client.ts";
import { present, toAsset, toMoney, toOptionalMoney } from "../mapping.ts";
import {
  clearingEvents,
  clearingTransactions,
  settlementEvents,
  webhookDeliveries,
} from "../schema.ts";

type Row = typeof clearingTransactions.$inferSelect;

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export class DrizzleAuditQueryRepository implements AuditQueryRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async listPayments(filter: AuditFilter): Promise<readonly PaymentAuditSummary[]> {
    const conditions: SQL[] = [eq(clearingTransactions.merchantId, filter.merchantId)];

    // Inclusive lower bound, exclusive upper: two adjacent windows cover every
    // payment exactly once, which is what makes period-by-period totals add up.
    if (filter.from !== undefined) {
      conditions.push(gte(clearingTransactions.createdAt, filter.from));
    }
    if (filter.to !== undefined) {
      conditions.push(lt(clearingTransactions.createdAt, filter.to));
    }
    if (filter.asset !== undefined) {
      conditions.push(eq(clearingTransactions.settlementAsset, filter.asset));
    }

    const rows = await this.#db
      .select()
      .from(clearingTransactions)
      .where(and(...conditions))
      .orderBy(desc(clearingTransactions.createdAt))
      .limit(boundedLimit(filter.limit));

    return rows.map(toSummary);
  }
}

/**
 * A caller-supplied limit is clamped rather than trusted.
 *
 * An audit export asking for everything is a legitimate request and a way to
 * pull the whole table into memory. The cap makes the page size a decision this
 * adapter owns.
 */
function boundedLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.trunc(limit)), MAX_LIMIT);
}

function toSummary(row: Row): PaymentAuditSummary {
  const settlementAsset = toAsset(row.settlementAsset);

  return {
    clearingTransactionId: row.id,
    paymentIntentId: row.paymentIntentId,
    merchantId: row.merchantId,
    state: row.state as ClearingState,
    sourceAmount: toMoney(row.sourceAmount, row.sourceAsset),
    settlementAsset,
    ...present("settlementAmount", toOptionalMoney(row.settlementAmount, row.settlementAsset)),
    ...present("fee", toOptionalMoney(row.feeAmount, row.settlementAsset)),
    ...present("netAmount", toOptionalMoney(row.netAmount, row.settlementAsset)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const DEFAULT_EVENT_LIMIT = 50;
const MAX_EVENT_LIMIT = 500;

/**
 * Postgres adapter for the merchant event log.
 *
 * Three bounded `LIMIT n` queries — one per source — merge-sorted in JS, then
 * sliced to `n`. A cross-table `UNION` over three tables that share no column
 * (clearing events key on a transaction id, settlement events on a contract
 * intent id, webhook deliveries on a merchant id) is more SQL than this read
 * is worth, and the per-source `LIMIT n` keeps each scan bounded however long
 * the history grows.
 *
 * The clearing event spine carries `merchantId` and `paymentIntentId`; the
 * other two join back to it. `settlement_events.intent_id` is the *contract*
 * intent id, so it joins `clearing_transactions.contract_intent_id`, not
 * `payment_intents.id`. Webhook deliveries carry `merchant_id` directly; their
 * `intent_id` is left undefined for v1 (the `event_id → clearing_event →
 * transaction → intent` join is nice-to-have, not load-bearing for a timeline).
 */
export class DrizzleMerchantEventRepository implements MerchantEventRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async listByMerchant(merchantId: string, limit?: number): Promise<readonly MerchantEventRow[]> {
    const n = eventLimit(limit);

    const [clearing, settlements, webhooks] = await Promise.all([
      this.#db
        .select({
          toState: clearingEvents.toState,
          occurredAt: clearingEvents.occurredAt,
          intentId: clearingTransactions.paymentIntentId,
        })
        .from(clearingEvents)
        .innerJoin(
          clearingTransactions,
          eq(clearingEvents.clearingTransactionId, clearingTransactions.id),
        )
        .where(eq(clearingTransactions.merchantId, merchantId))
        .orderBy(desc(clearingEvents.occurredAt))
        .limit(n),
      this.#db
        .select({
          status: settlementEvents.status,
          confirmedAt: settlementEvents.confirmedAt,
          firstSeenAt: settlementEvents.firstSeenAt,
          orphanedAt: settlementEvents.orphanedAt,
          intentId: clearingTransactions.paymentIntentId,
        })
        .from(settlementEvents)
        .innerJoin(
          clearingTransactions,
          eq(clearingTransactions.contractIntentId, settlementEvents.intentId),
        )
        .where(eq(clearingTransactions.merchantId, merchantId))
        .orderBy(desc(settlementEvents.firstSeenAt))
        .limit(n),
      this.#db
        .select({
          status: webhookDeliveries.status,
          deliveredAt: webhookDeliveries.deliveredAt,
          createdAt: webhookDeliveries.createdAt,
        })
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.merchantId, merchantId))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(n),
    ]);

    const rows: MerchantEventRow[] = [
      ...clearing.map((r) => ({
        kind: "clearing" as const,
        occurredAt: r.occurredAt,
        merchantId,
        intentId: r.intentId,
        summary: `Clearing ${r.toState}`,
        severity: clearingSeverity(r.toState as ClearingState),
      })),
      ...settlements.map((r) => ({
        kind: "settlement" as const,
        occurredAt: r.confirmedAt ?? r.firstSeenAt,
        merchantId,
        intentId: r.intentId,
        summary: `Settlement ${r.status.toLowerCase()}`,
        severity: settlementSeverity(r.status, r.orphanedAt),
      })),
      ...webhooks.map((r) => ({
        kind: "webhook" as const,
        occurredAt: r.deliveredAt ?? r.createdAt,
        merchantId,
        // v1 gap: the eventId → clearingEvent → intent join is not wired.
        summary: `Webhook ${r.status.toLowerCase()}`,
        severity: webhookSeverity(r.status),
      })),
    ];

    return rows.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, n);
  }
}

function eventLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_EVENT_LIMIT;
  return Math.min(Math.max(1, Math.trunc(limit)), MAX_EVENT_LIMIT);
}

function clearingSeverity(state: ClearingState): MerchantEventSeverity {
  if (state === "FAILED") return "error";
  if (state === "SUCCESS") return "success";
  return "info";
}

function settlementSeverity(status: string, orphanedAt: Date | null): MerchantEventSeverity {
  if (orphanedAt !== null) return "warning";
  if (status === "CONFIRMED") return "success";
  return "info";
}

function webhookSeverity(status: string): MerchantEventSeverity {
  if (status === "DELIVERED") return "success";
  if (status === "DEAD") return "error";
  return "info";
}

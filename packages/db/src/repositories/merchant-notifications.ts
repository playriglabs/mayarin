/**
 * The merchant's notification feed — derived, not stored.
 *
 * Every notification is a record the system already keeps: a clearing event, a
 * dispute, a refund, a settings change, a sign-in. Writing each one a second
 * time into a notifications table would need a writer at every one of those
 * places, across three processes, and a copy that can drift from the record it
 * describes. So the feed is read straight off the sources, the way the event
 * log is (`audit.ts`): one bounded `LIMIT n` query per source, merged and
 * sliced in JS.
 *
 * The only state a notification adds is whether it was seen, and that is one
 * timestamp per user (`users.notifications_read_at`), not a flag per row.
 *
 * Ids are `<type>:<source row id>`, so the same record always yields the same
 * notification however often the feed is read, and one record may yield
 * several (a dispute is opened, then decided).
 */

import type { Money } from "@mayarin/shared";
import { and, desc, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import type { Executor } from "../client.ts";
import { toMoney, toOptionalMoney } from "../mapping.ts";
import {
  clearingEvents,
  clearingTransactions,
  escrowDisputeMessages,
  escrowDisputes,
  invoices,
  merchantApiKeys,
  merchantSettingChanges,
  paymentIntents,
  payoutBatches,
  refunds,
  sessions,
  subscriptions,
  users,
  walletWithdrawals,
  webhookDeliveries,
  webhookEndpoints,
} from "../schema.ts";

export const MERCHANT_NOTIFICATION_TYPES = [
  "payment.received",
  "payment.held",
  "payment.paid",
  "payment.failed",
  "dispute.opened",
  "dispute.message",
  "dispute.deadline",
  "dispute.released",
  "dispute.refunded",
  "dispute.split",
  "refund.succeeded",
  "refund.failed",
  "withdrawal.sent",
  "payout.sent",
  "settings.changed",
  "security.settlement_address",
  "security.sign_in",
  "security.api_key_created",
  "security.api_key_revoked",
  "security.member_added",
  "webhook.failed",
  "invoice.paid",
  "invoice.overdue",
  "subscription.cancelled",
] as const;

export type MerchantNotificationType = (typeof MERCHANT_NOTIFICATION_TYPES)[number];

export interface MerchantNotification {
  readonly id: string;
  readonly type: MerchantNotificationType;
  readonly occurredAt: Date;
  readonly paymentIntentId?: string;
  readonly disputeId?: string;
  readonly amount?: Money;
  /** The one fact the line needs beyond the amount: a field, a URL, a reason, a name. */
  readonly detail?: string;
  /** The account behind it, by email, when a person did it. */
  readonly actor?: string;
}

export interface MerchantNotificationQuery {
  readonly now: Date;
  readonly limit: number;
  /** The reader's own session, which is not news to them. */
  readonly excludeSessionId?: string;
}

/** How long before `resolveBy` an open dispute is announced as running out. */
const DEADLINE_NOTICE_MS = 48 * 60 * 60 * 1000;

export class DrizzleMerchantNotificationRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async list(
    merchantId: string,
    query: MerchantNotificationQuery,
  ): Promise<readonly MerchantNotification[]> {
    const n = query.limit;
    const sources = await Promise.all([
      this.#clearing(merchantId, n),
      this.#escrowReleases(merchantId, n),
      this.#disputes(merchantId, n, query.now),
      this.#disputeMessages(merchantId, n),
      this.#refunds(merchantId, n),
      this.#withdrawals(merchantId, n),
      this.#payouts(merchantId, n),
      this.#settingChanges(merchantId, n),
      this.#signIns(merchantId, n, query.excludeSessionId),
      this.#apiKeys(merchantId, n),
      this.#members(merchantId, n),
      this.#webhooks(merchantId, n),
      this.#invoices(merchantId, n, query.now),
      this.#subscriptions(merchantId, n),
    ]);
    return sources
      .flat()
      .map((notification) => ({ ...notification, id: `${notification.type}:${notification.id}` }))
      .filter((notification) => notification.occurredAt.getTime() <= query.now.getTime())
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, n);
  }

  async readAt(userId: string): Promise<Date | undefined> {
    const [row] = await this.#db
      .select({ readAt: users.notificationsReadAt })
      .from(users)
      .where(eq(users.id, userId));
    return row?.readAt ?? undefined;
  }

  async markRead(userId: string, at: Date): Promise<void> {
    await this.#db.update(users).set({ notificationsReadAt: at }).where(eq(users.id, userId));
  }

  /** Funds arrived, the payment completed, or it failed. */
  async #clearing(merchantId: string, n: number): Promise<MerchantNotification[]> {
    const rows = await this.#db
      .select({
        id: clearingEvents.id,
        type: clearingEvents.type,
        toState: clearingEvents.toState,
        occurredAt: clearingEvents.occurredAt,
        paymentIntentId: clearingTransactions.paymentIntentId,
        amount: paymentIntents.amount,
        amountAsset: paymentIntents.amountAsset,
        netAmount: clearingTransactions.netAmount,
        settlementAsset: clearingTransactions.settlementAsset,
        escrow: clearingTransactions.contractEscrow,
        failureReason: clearingTransactions.failureReason,
      })
      .from(clearingEvents)
      .innerJoin(
        clearingTransactions,
        eq(clearingEvents.clearingTransactionId, clearingTransactions.id),
      )
      .innerJoin(paymentIntents, eq(paymentIntents.id, clearingTransactions.paymentIntentId))
      .where(
        and(
          eq(clearingTransactions.merchantId, merchantId),
          or(
            and(
              eq(clearingEvents.type, "state.changed"),
              inArray(clearingEvents.toState, ["ASSET_RECEIVED", "SUCCESS"]),
            ),
            eq(clearingEvents.type, "state.failed"),
          ),
        ),
      )
      .orderBy(desc(clearingEvents.occurredAt))
      .limit(n);

    return rows.map((row): MerchantNotification => {
      const base = {
        id: row.id,
        occurredAt: row.occurredAt,
        paymentIntentId: row.paymentIntentId,
      };
      const priced = toMoney(row.amount, row.amountAsset);
      if (row.type === "state.failed") {
        return {
          ...base,
          type: "payment.failed",
          amount: priced,
          ...(row.failureReason === null ? {} : { detail: row.failureReason }),
        };
      }
      if (row.toState === "ASSET_RECEIVED") {
        return { ...base, type: "payment.received", amount: priced };
      }
      // SUCCESS. Escrowed funds are not the merchant's until the hold ends, so
      // an escrowed payment is "held" here and "paid" when the escrow releases.
      if (row.escrow !== null) {
        return {
          ...base,
          type: "payment.held",
          amount: priced,
          detail: new Date(Number(row.escrow.releaseAfter) * 1000).toISOString(),
        };
      }
      return {
        ...base,
        type: "payment.paid",
        amount: toOptionalMoney(row.netAmount, row.settlementAsset) ?? priced,
      };
    });
  }

  /** An escrow the hold ran out on with nobody disputing it: the merchant is paid. */
  async #escrowReleases(merchantId: string, n: number): Promise<MerchantNotification[]> {
    const rows = await this.#db
      .select({
        id: clearingTransactions.id,
        paymentIntentId: clearingTransactions.paymentIntentId,
        closedAt: clearingTransactions.escrowClosedAt,
        netAmount: clearingTransactions.netAmount,
        settlementAsset: clearingTransactions.settlementAsset,
        amount: paymentIntents.amount,
        amountAsset: paymentIntents.amountAsset,
      })
      .from(clearingTransactions)
      .innerJoin(paymentIntents, eq(paymentIntents.id, clearingTransactions.paymentIntentId))
      .where(
        and(
          eq(clearingTransactions.merchantId, merchantId),
          eq(clearingTransactions.escrowOutcome, "released"),
          isNotNull(clearingTransactions.escrowClosedAt),
          sql`not exists (select 1 from ${escrowDisputes} where ${escrowDisputes.paymentIntentId} = ${clearingTransactions.paymentIntentId})`,
        ),
      )
      .orderBy(desc(clearingTransactions.escrowClosedAt))
      .limit(n);

    return rows.flatMap((row): MerchantNotification[] =>
      row.closedAt === null
        ? []
        : [
            {
              id: row.id,
              type: "payment.paid",
              occurredAt: row.closedAt,
              paymentIntentId: row.paymentIntentId,
              amount:
                toOptionalMoney(row.netAmount, row.settlementAsset) ??
                toMoney(row.amount, row.amountAsset),
            },
          ],
    );
  }

  /** Opened, running out of time, and decided — up to three lines per dispute. */
  async #disputes(merchantId: string, n: number, now: Date): Promise<MerchantNotification[]> {
    const rows = await this.#db
      .select({
        id: escrowDisputes.id,
        paymentIntentId: escrowDisputes.paymentIntentId,
        status: escrowDisputes.status,
        resolveBy: escrowDisputes.resolveBy,
        decidedAt: escrowDisputes.decidedAt,
        createdAt: escrowDisputes.createdAt,
        amount: paymentIntents.amount,
        amountAsset: paymentIntents.amountAsset,
      })
      .from(escrowDisputes)
      .innerJoin(paymentIntents, eq(paymentIntents.id, escrowDisputes.paymentIntentId))
      .where(eq(escrowDisputes.merchantId, merchantId))
      .orderBy(desc(sql`coalesce(${escrowDisputes.decidedAt}, ${escrowDisputes.createdAt})`))
      .limit(n);

    return rows.flatMap((row) => {
      const base = {
        paymentIntentId: row.paymentIntentId,
        disputeId: row.id,
        amount: toMoney(row.amount, row.amountAsset),
      };
      const opened: MerchantNotification = {
        ...base,
        id: row.id,
        type: "dispute.opened",
        occurredAt: row.createdAt,
        detail: row.resolveBy.toISOString(),
      };
      const noticeAt = new Date(row.resolveBy.getTime() - DEADLINE_NOTICE_MS);
      const deadline: MerchantNotification[] =
        row.status === "open" && now.getTime() >= noticeAt.getTime()
          ? [
              {
                ...base,
                id: row.id,
                type: "dispute.deadline",
                occurredAt: noticeAt,
                detail: row.resolveBy.toISOString(),
              },
            ]
          : [];
      const decided = decidedType(row.status);
      const outcome: MerchantNotification[] =
        decided === undefined || row.decidedAt === null
          ? []
          : [{ ...base, id: row.id, type: decided, occurredAt: row.decidedAt }];
      return [opened, ...deadline, ...outcome];
    });
  }

  /** The buyer's side of the thread; the merchant's own messages are not news to them. */
  async #disputeMessages(merchantId: string, n: number): Promise<MerchantNotification[]> {
    const rows = await this.#db
      .select({
        id: escrowDisputeMessages.id,
        disputeId: escrowDisputeMessages.disputeId,
        author: escrowDisputeMessages.author,
        createdAt: escrowDisputeMessages.createdAt,
        paymentIntentId: escrowDisputes.paymentIntentId,
      })
      .from(escrowDisputeMessages)
      .innerJoin(escrowDisputes, eq(escrowDisputes.id, escrowDisputeMessages.disputeId))
      .where(
        and(
          eq(escrowDisputes.merchantId, merchantId),
          ne(escrowDisputeMessages.author, "merchant"),
        ),
      )
      .orderBy(desc(escrowDisputeMessages.createdAt))
      .limit(n);

    return rows.map((row) => ({
      id: row.id,
      type: "dispute.message",
      occurredAt: row.createdAt,
      paymentIntentId: row.paymentIntentId,
      disputeId: row.disputeId,
      detail: row.author,
    }));
  }

  async #refunds(merchantId: string, n: number): Promise<MerchantNotification[]> {
    const rows = await this.#db
      .select()
      .from(refunds)
      .where(
        and(eq(refunds.merchantId, merchantId), inArray(refunds.state, ["SUCCEEDED", "FAILED"])),
      )
      .orderBy(desc(refunds.updatedAt))
      .limit(n);

    return rows.map((row) => ({
      id: row.id,
      type: row.state === "FAILED" ? "refund.failed" : "refund.succeeded",
      occurredAt: row.updatedAt,
      paymentIntentId: row.paymentIntentId,
      amount: toMoney(row.amount, row.amountAsset),
      ...(row.failureReason === null ? {} : { detail: row.failureReason }),
    }));
  }

  async #withdrawals(merchantId: string, n: number): Promise<MerchantNotification[]> {
    const rows = await this.#db
      .select()
      .from(walletWithdrawals)
      .where(eq(walletWithdrawals.merchantId, merchantId))
      .orderBy(desc(walletWithdrawals.completedAt))
      .limit(n);

    return rows.map((row) => ({
      id: row.id,
      type: "withdrawal.sent",
      occurredAt: row.completedAt,
      amount: toMoney(row.amount, row.asset),
      detail: row.destinationAddress,
    }));
  }

  async #payouts(merchantId: string, n: number): Promise<MerchantNotification[]> {
    const rows = await this.#db
      .select({
        id: payoutBatches.id,
        rows: payoutBatches.rows,
        completedAt: payoutBatches.completedAt,
      })
      .from(payoutBatches)
      .where(eq(payoutBatches.merchantId, merchantId))
      .orderBy(desc(payoutBatches.completedAt))
      .limit(n);

    return rows.map((row) => ({
      id: row.id,
      type: "payout.sent",
      occurredAt: row.completedAt,
      detail: String(row.rows.length),
    }));
  }

  /** A changed payout address is a redirect of the merchant's money, so it is its own type. */
  async #settingChanges(merchantId: string, n: number): Promise<MerchantNotification[]> {
    const rows = await this.#db
      .select({
        id: merchantSettingChanges.id,
        field: merchantSettingChanges.field,
        changedAt: merchantSettingChanges.changedAt,
        email: users.email,
      })
      .from(merchantSettingChanges)
      .innerJoin(users, eq(users.id, merchantSettingChanges.userId))
      .where(eq(merchantSettingChanges.merchantId, merchantId))
      .orderBy(desc(merchantSettingChanges.changedAt))
      .limit(n);

    return rows.map((row) => ({
      id: row.id,
      type: row.field === "settlementAddress" ? "security.settlement_address" : "settings.changed",
      occurredAt: row.changedAt,
      detail: row.field,
      actor: row.email,
    }));
  }

  async #signIns(
    merchantId: string,
    n: number,
    excludeSessionId: string | undefined,
  ): Promise<MerchantNotification[]> {
    const rows = await this.#db
      .select({ id: sessions.id, createdAt: sessions.createdAt, email: users.email })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(users.merchantId, merchantId),
          excludeSessionId === undefined ? undefined : ne(sessions.id, excludeSessionId),
        ),
      )
      .orderBy(desc(sessions.createdAt))
      .limit(n);

    return rows.map((row) => ({
      id: row.id,
      type: "security.sign_in",
      occurredAt: row.createdAt,
      actor: row.email,
    }));
  }

  async #apiKeys(merchantId: string, n: number): Promise<MerchantNotification[]> {
    const rows = await this.#db
      .select({
        id: merchantApiKeys.id,
        name: merchantApiKeys.name,
        active: merchantApiKeys.active,
        createdAt: merchantApiKeys.createdAt,
        updatedAt: merchantApiKeys.updatedAt,
      })
      .from(merchantApiKeys)
      .where(eq(merchantApiKeys.merchantId, merchantId))
      .orderBy(desc(merchantApiKeys.updatedAt))
      .limit(n);

    return rows.flatMap((row): MerchantNotification[] => [
      {
        id: row.id,
        type: "security.api_key_created",
        occurredAt: row.createdAt,
        detail: row.name,
      },
      ...(row.active
        ? []
        : [
            {
              id: row.id,
              type: "security.api_key_revoked" as const,
              occurredAt: row.updatedAt,
              detail: row.name,
            },
          ]),
    ]);
  }

  /** Every account but the first: the first is the one that registered the merchant. */
  async #members(merchantId: string, n: number): Promise<MerchantNotification[]> {
    const rows = await this.#db
      .select({ id: users.id, email: users.email, createdAt: users.createdAt })
      .from(users)
      .where(
        and(
          eq(users.merchantId, merchantId),
          sql`exists (select 1 from ${users} as earlier where earlier.merchant_id = ${users.merchantId} and earlier.created_at < ${users.createdAt})`,
        ),
      )
      .orderBy(desc(users.createdAt))
      .limit(n);

    return rows.map((row) => ({
      id: row.id,
      type: "security.member_added",
      occurredAt: row.createdAt,
      actor: row.email,
    }));
  }

  /** A delivery that exhausted its retries: the merchant's system missed an event. */
  async #webhooks(merchantId: string, n: number): Promise<MerchantNotification[]> {
    const rows = await this.#db
      .select({
        id: webhookDeliveries.id,
        updatedAt: webhookDeliveries.updatedAt,
        url: webhookEndpoints.url,
      })
      .from(webhookDeliveries)
      .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
      .where(
        and(eq(webhookDeliveries.merchantId, merchantId), eq(webhookDeliveries.status, "DEAD")),
      )
      .orderBy(desc(webhookDeliveries.updatedAt))
      .limit(n);

    return rows.map((row) => ({
      id: row.id,
      type: "webhook.failed",
      occurredAt: row.updatedAt,
      detail: row.url,
    }));
  }

  /**
   * Paid in full, or past due and not. The paid sum is the invoice's own rule
   * (`@mayarin/invoicing` balance): completed intents carrying its number, in
   * its currency.
   */
  async #invoices(merchantId: string, n: number, now: Date): Promise<MerchantNotification[]> {
    const payments = sql`from ${paymentIntents} where ${paymentIntents.merchantId} = ${invoices.merchantId} and ${paymentIntents.merchantReference} = ${invoices.number} and ${paymentIntents.status} = 'COMPLETED' and ${paymentIntents.amountAsset} = ${invoices.currency}`;
    const rows = await this.#db
      .select({
        id: invoices.id,
        number: invoices.number,
        total: invoices.total,
        totalAsset: invoices.totalAsset,
        dueAt: invoices.dueAt,
        paid: sql<string | null>`(select sum(${paymentIntents.amount}) ${payments})`,
        lastPaidAt: sql`(select max(${paymentIntents.completedAt}) ${payments})`.mapWith(
          paymentIntents.completedAt,
        ),
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.merchantId, merchantId),
          eq(invoices.state, "issued"),
          isNotNull(invoices.number),
        ),
      )
      .orderBy(desc(invoices.updatedAt))
      .limit(n);

    return rows.flatMap((row): MerchantNotification[] => {
      const total = toMoney(row.total, row.totalAsset);
      const paid = BigInt(row.paid ?? "0");
      const detail = row.number ?? row.id;
      if (paid >= total.amount && row.lastPaidAt !== null) {
        return [
          {
            id: row.id,
            type: "invoice.paid",
            occurredAt: row.lastPaidAt,
            amount: total,
            detail,
          },
        ];
      }
      if (row.dueAt !== null && row.dueAt.getTime() <= now.getTime()) {
        return [
          {
            id: row.id,
            type: "invoice.overdue",
            occurredAt: row.dueAt,
            amount: total,
            detail,
          },
        ];
      }
      return [];
    });
  }

  async #subscriptions(merchantId: string, n: number): Promise<MerchantNotification[]> {
    const rows = await this.#db
      .select({
        id: subscriptions.id,
        subscriberName: subscriptions.subscriberName,
        cancelledAt: subscriptions.cancelledAt,
      })
      .from(subscriptions)
      .where(and(eq(subscriptions.merchantId, merchantId), isNotNull(subscriptions.cancelledAt)))
      .orderBy(desc(subscriptions.cancelledAt))
      .limit(n);

    return rows.flatMap((row): MerchantNotification[] =>
      row.cancelledAt === null
        ? []
        : [
            {
              id: row.id,
              type: "subscription.cancelled",
              occurredAt: row.cancelledAt,
              detail: row.subscriberName,
            },
          ],
    );
  }
}

function decidedType(status: string): MerchantNotificationType | undefined {
  if (status === "released") return "dispute.released";
  if (status === "refunded") return "dispute.refunded";
  if (status === "split") return "dispute.split";
  return undefined;
}

/**
 * Escrow disputes (#313): the case file beside the on-chain `disputed` flag.
 *
 * The chain decides where the money goes; these rows decide nothing. They hold
 * who is involved, the deadline, and an append-only evidence thread, and their
 * `status` only ever follows what the chain already shows.
 *
 * Addresses are stored lower-cased so a comparison never depends on checksum
 * casing.
 */

import { generateId } from "@mayarin/shared";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Executor } from "../client.ts";
import { clearingTransactions, escrowDisputeMessages, escrowDisputes } from "../schema.ts";

/** `split` when the arbiter divided a v2 escrow (#315). */
export type DisputeStatus = "open" | "released" | "refunded" | "split";
export type DisputeAuthor = "payer" | "merchant" | "arbiter";
export type DisputeAlert = "48h" | "24h";

export interface EscrowDispute {
  readonly id: string;
  readonly paymentIntentId: string;
  readonly merchantId: string;
  readonly chain: string;
  readonly factory: string;
  readonly payer: string;
  readonly payee: string;
  readonly arbiter: string;
  readonly releaseAfter: Date;
  readonly resolveBy: Date;
  readonly status: DisputeStatus;
  readonly decidedAt: Date | undefined;
  readonly alerted: DisputeAlert | undefined;
  readonly createdAt: Date;
}

export interface DisputeMessage {
  readonly id: string;
  readonly disputeId: string;
  readonly author: DisputeAuthor;
  readonly body: string;
  readonly createdAt: Date;
}

/** What opening a dispute needs: the escrow's parties and deadlines. */
export type OpenDispute = Pick<
  EscrowDispute,
  | "paymentIntentId"
  | "merchantId"
  | "chain"
  | "factory"
  | "payer"
  | "payee"
  | "arbiter"
  | "releaseAfter"
  | "resolveBy"
>;

/**
 * One wallet's escrow history across every merchant (#314). Counts only — no
 * payment, merchant or amount — which is all standing needs.
 */
export interface PayerRecord {
  /** Escrowed payments that settled into escrow from this wallet. */
  readonly escrowed: number;
  readonly disputes: number;
  /** Disputes that ended released to the merchant: the payer's claim did not hold. */
  readonly lost: number;
}

type Row = typeof escrowDisputes.$inferSelect;
type MessageRow = typeof escrowDisputeMessages.$inferSelect;

export class DrizzleEscrowDisputeRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  /** Opens the case file for a disputed escrow. Idempotent: an existing one is returned. */
  async open(input: OpenDispute, now: Date): Promise<EscrowDispute> {
    await this.#db
      .insert(escrowDisputes)
      .values({
        id: generateId("dsp", now.getTime()),
        paymentIntentId: input.paymentIntentId,
        merchantId: input.merchantId,
        chain: input.chain,
        factory: input.factory.toLowerCase(),
        payer: input.payer.toLowerCase(),
        payee: input.payee.toLowerCase(),
        arbiter: input.arbiter.toLowerCase(),
        releaseAfter: input.releaseAfter,
        resolveBy: input.resolveBy,
        status: "open",
        createdAt: now,
      })
      .onConflictDoNothing({ target: escrowDisputes.paymentIntentId });
    const opened = await this.findByPaymentIntentId(input.paymentIntentId);
    if (opened === undefined) throw new Error(`Dispute for ${input.paymentIntentId} not found`);
    return opened;
  }

  async findById(id: string): Promise<EscrowDispute | undefined> {
    const [row] = await this.#db
      .select()
      .from(escrowDisputes)
      .where(eq(escrowDisputes.id, id))
      .limit(1);
    return row === undefined ? undefined : toDispute(row);
  }

  async findByPaymentIntentId(paymentIntentId: string): Promise<EscrowDispute | undefined> {
    const [row] = await this.#db
      .select()
      .from(escrowDisputes)
      .where(eq(escrowDisputes.paymentIntentId, paymentIntentId))
      .limit(1);
    return row === undefined ? undefined : toDispute(row);
  }

  /** Open disputes, nearest `resolveBy` first — the arbiter's queue. */
  async listOpen(): Promise<readonly EscrowDispute[]> {
    const rows = await this.#db
      .select()
      .from(escrowDisputes)
      .where(eq(escrowDisputes.status, "open"))
      .orderBy(asc(escrowDisputes.resolveBy));
    return rows.map(toDispute);
  }

  /** One merchant's disputes, newest first — what the merchant answers. */
  async listByMerchant(merchantId: string, limit = 100): Promise<readonly EscrowDispute[]> {
    const rows = await this.#db
      .select()
      .from(escrowDisputes)
      .where(eq(escrowDisputes.merchantId, merchantId))
      .orderBy(desc(escrowDisputes.createdAt))
      .limit(limit);
    return rows.map(toDispute);
  }

  /** Records the chain's outcome. Only an open dispute moves; a closed one stays as it was. */
  async close(
    paymentIntentId: string,
    status: Exclude<DisputeStatus, "open">,
    now: Date,
  ): Promise<void> {
    await this.#db
      .update(escrowDisputes)
      .set({ status, decidedAt: now })
      .where(
        and(eq(escrowDisputes.paymentIntentId, paymentIntentId), eq(escrowDisputes.status, "open")),
      );
  }

  async markAlerted(id: string, alert: DisputeAlert): Promise<void> {
    await this.#db.update(escrowDisputes).set({ alerted: alert }).where(eq(escrowDisputes.id, id));
  }

  async payerRecord(payer: string): Promise<PayerRecord> {
    const wallet = payer.toLowerCase();
    const [escrowed] = await this.#db
      .select({ count: sql<number>`count(*)::int` })
      .from(clearingTransactions)
      .where(sql`
        ${clearingTransactions.state} = 'SUCCESS'
        and lower(${clearingTransactions.contractEscrow} ->> 'payer') = ${wallet}
      `);
    const [disputes] = await this.#db
      .select({
        count: sql<number>`count(*)::int`,
        lost: sql<number>`count(*) filter (where ${escrowDisputes.status} = 'released')::int`,
      })
      .from(escrowDisputes)
      .where(eq(escrowDisputes.payer, wallet));
    return {
      escrowed: escrowed?.count ?? 0,
      disputes: disputes?.count ?? 0,
      lost: disputes?.lost ?? 0,
    };
  }

  /** The thread, oldest first. */
  async listMessages(disputeId: string): Promise<readonly DisputeMessage[]> {
    const rows = await this.#db
      .select()
      .from(escrowDisputeMessages)
      .where(eq(escrowDisputeMessages.disputeId, disputeId))
      .orderBy(asc(escrowDisputeMessages.createdAt), asc(escrowDisputeMessages.id));
    return rows.map(toMessage);
  }

  async addMessage(
    disputeId: string,
    author: DisputeAuthor,
    body: string,
    now: Date,
  ): Promise<DisputeMessage> {
    const message: DisputeMessage = {
      id: generateId("dsm", now.getTime()),
      disputeId,
      author,
      body,
      createdAt: now,
    };
    await this.#db.insert(escrowDisputeMessages).values(message);
    return message;
  }
}

function toDispute(row: Row): EscrowDispute {
  return {
    id: row.id,
    paymentIntentId: row.paymentIntentId,
    merchantId: row.merchantId,
    chain: row.chain,
    factory: row.factory,
    payer: row.payer,
    payee: row.payee,
    arbiter: row.arbiter,
    releaseAfter: row.releaseAfter,
    resolveBy: row.resolveBy,
    status: row.status as DisputeStatus,
    decidedAt: row.decidedAt ?? undefined,
    alerted: (row.alerted ?? undefined) as DisputeAlert | undefined,
    createdAt: row.createdAt,
  };
}

function toMessage(row: MessageRow): DisputeMessage {
  return {
    id: row.id,
    disputeId: row.disputeId,
    author: row.author as DisputeAuthor,
    body: row.body,
    createdAt: row.createdAt,
  };
}

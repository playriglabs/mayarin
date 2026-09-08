/**
 * Postgres adapter for the x402 payable quote lock (#273).
 *
 * The claim is the one nontrivial statement in this file, and it is a single
 * conditional `UPDATE` on purpose: two agents racing one obligation both reach
 * `claim`, and only a statement the database serializes can guarantee that one
 * nonce wins and the other is refused. The read-then-decide shape would let both
 * through, and both would spend money on-chain.
 *
 * `save` is the mirror of that rule: a refresh must never overwrite a live
 * claim, because an authorization may already be in flight against the stored
 * row. The condition lives in the conflict clause, not in the caller.
 */

import { ConflictError } from "@mayarin/shared";
import type {
  PayableClaimResult,
  PayableKind,
  PayableQuote,
  PayableQuoteRepository,
} from "@mayarin/x402";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { Executor } from "../client.ts";
import { present, toMoney } from "../mapping.ts";
import { x402PayableQuotes } from "../schema.ts";
import { toAccepts } from "./x402.ts";

type Row = typeof x402PayableQuotes.$inferSelect;

export class DrizzlePayableQuoteRepository implements PayableQuoteRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async find(kind: PayableKind, obligationId: string): Promise<PayableQuote | undefined> {
    const [row] = await this.#db
      .select()
      .from(x402PayableQuotes)
      .where(
        and(eq(x402PayableQuotes.kind, kind), eq(x402PayableQuotes.obligationId, obligationId)),
      )
      .limit(1);
    return row === undefined ? undefined : toQuote(row);
  }

  async save(quote: PayableQuote, options: { readonly now: Date }): Promise<void> {
    const mutable = {
      merchantId: quote.merchantId,
      amount: quote.amount.amount.toString(),
      asset: quote.amount.asset,
      accepts: [...quote.accepts],
      expiresAt: quote.expiresAt,
      status: quote.status,
      claimedNonce: quote.claimedNonce ?? null,
      claimedAt: quote.claimedAt ?? null,
      updatedAt: options.now,
    };

    await this.#db
      .insert(x402PayableQuotes)
      // `createdAt` is set here and never in the conflict update, so a refresh
      // keeps the moment the obligation was first made payable.
      .values({
        kind: quote.kind,
        obligationId: quote.obligationId,
        createdAt: quote.createdAt,
        ...mutable,
      })
      .onConflictDoUpdate({
        target: [x402PayableQuotes.kind, x402PayableQuotes.obligationId],
        set: mutable,
        // A live claim is not clobbered: an authorization may already be in
        // flight against the stored row. Everything else — spent, expired,
        // settled, or never claimed — is refreshed by the new quote.
        setWhere: sql`not (${x402PayableQuotes.status} = 'claimed' and ${gt(
          x402PayableQuotes.expiresAt,
          options.now,
        )})`,
      });
  }

  async claim(
    kind: PayableKind,
    obligationId: string,
    nonce: string,
    now: Date,
  ): Promise<PayableClaimResult> {
    const rows = await this.#db
      .update(x402PayableQuotes)
      .set({ claimedNonce: nonce, claimedAt: now, status: "claimed", updatedAt: now })
      .where(
        and(
          eq(x402PayableQuotes.kind, kind),
          eq(x402PayableQuotes.obligationId, obligationId),
          or(
            // Resume: the same nonce is already spent on-chain, so it passes
            // regardless of expiry — no other path can recover that money.
            eq(x402PayableQuotes.claimedNonce, nonce),
            and(
              isNull(x402PayableQuotes.claimedNonce),
              eq(x402PayableQuotes.status, "quoted"),
              gt(x402PayableQuotes.expiresAt, now),
            ),
          ),
        ),
      )
      .returning();

    const claimed = rows[0];
    if (claimed !== undefined) return { ok: true, quote: toQuote(claimed) };

    // Zero rows: say why, with the same semantics the in-memory fake has. The
    // claim lapses with the quote — past expiry every refusal is `expired`,
    // because the remedy is the same: request a new `402`.
    const row = await this.find(kind, obligationId);
    if (row === undefined) return { ok: false, reason: "missing" };
    if (
      row.claimedNonce !== undefined &&
      row.claimedNonce !== nonce &&
      row.expiresAt.getTime() > now.getTime()
    ) {
      return { ok: false, reason: "claimed-by-other", quote: row };
    }
    return { ok: false, reason: "expired", quote: row };
  }

  async markSettled(kind: PayableKind, obligationId: string, now: Date): Promise<void> {
    const updated = await this.#db
      .update(x402PayableQuotes)
      .set({ status: "settled", updatedAt: now })
      .where(
        and(eq(x402PayableQuotes.kind, kind), eq(x402PayableQuotes.obligationId, obligationId)),
      )
      .returning({ kind: x402PayableQuotes.kind });

    if (updated.length === 0) {
      throw new ConflictError(`No x402 payable quote for ${kind} ${obligationId} to mark settled`, {
        kind,
        obligationId,
      });
    }
  }
}

function toQuote(row: Row): PayableQuote {
  return {
    kind: row.kind as PayableKind,
    obligationId: row.obligationId,
    merchantId: row.merchantId,
    // Same care as the resource adapter: `accepts` is what the payer signed
    // against, so a row we cannot interpret is a hard error, never a quote
    // with one fewer way to pay.
    amount: toMoney(row.amount, row.asset),
    accepts: toAccepts(row.accepts, row.obligationId),
    expiresAt: row.expiresAt,
    status: row.status as PayableQuote["status"],
    ...present("claimedNonce", row.claimedNonce),
    ...present("claimedAt", row.claimedAt),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

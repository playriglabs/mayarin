/**
 * Reference in-memory fake for the payable quote port, shipped in a segregated
 * `/testing` subpath so domain `src/` stays pure.
 *
 * Mirrors the guarantees the Postgres implementation has to hold — one row per
 * obligation, a claim that never clobbers a live claim, a same-nonce resume
 * that passes past expiry — so a test exercises the same failure modes without
 * a database. Single-threaded JavaScript makes the claim trivially atomic here,
 * which is exactly why passing here is not evidence that the conditional
 * `UPDATE` in the Postgres adapter is correct: that one needs its own test
 * against a database.
 */

import { ConflictError } from "@mayarin/shared";
import type {
  PayableClaimResult,
  PayableKind,
  PayableQuote,
  PayableQuoteRepository,
} from "../src/index.ts";

export class InMemoryPayableQuoteRepository implements PayableQuoteRepository {
  readonly #byKey = new Map<string, PayableQuote>();

  async find(kind: PayableKind, obligationId: string): Promise<PayableQuote | undefined> {
    return this.#byKey.get(`${kind}:${obligationId}`);
  }

  /**
   * A refresh clobbers a live claim never, a spent or expired row always — the
   * same condition the SQL upsert's `where` clause enforces. The caller passes a
   * freshly quoted row (status `quoted`, no claim), so a refresh resets any
   * spent claim by construction.
   */
  async save(quote: PayableQuote, options: { readonly now: Date }): Promise<void> {
    const key = `${quote.kind}:${quote.obligationId}`;
    const existing = this.#byKey.get(key);
    if (existing !== undefined && !this.#refreshable(existing, options.now)) {
      // Leave the claimed row alone; the caller serves it as stored.
      return;
    }
    this.#byKey.set(key, {
      ...quote,
      createdAt: existing?.createdAt ?? quote.createdAt,
      updatedAt: options.now,
    });
  }

  async claim(
    kind: PayableKind,
    obligationId: string,
    nonce: string,
    now: Date,
  ): Promise<PayableClaimResult> {
    const existing = await this.find(kind, obligationId);
    if (existing === undefined) return { ok: false, reason: "missing" };

    // A resume passes regardless of expiry: the nonce is already spent on-chain.
    if (existing.claimedNonce === nonce) return { ok: true, quote: existing };

    // The claim lapses with the quote: while the window is open, another nonce
    // is told someone else is paying this obligation; once it has closed, the
    // refusal is "expired" for every nonce — the remedy is a new 402, and that
    // is what resets the row.
    if (existing.claimedNonce !== undefined && existing.expiresAt.getTime() > now.getTime()) {
      return { ok: false, reason: "claimed-by-other", quote: existing };
    }
    if (existing.status !== "quoted" || existing.expiresAt.getTime() <= now.getTime()) {
      return { ok: false, reason: "expired", quote: existing };
    }

    const claimed: PayableQuote = {
      ...existing,
      status: "claimed",
      claimedNonce: nonce,
      claimedAt: now,
      updatedAt: now,
    };
    this.#byKey.set(`${kind}:${obligationId}`, claimed);
    return { ok: true, quote: claimed };
  }

  async markSettled(kind: PayableKind, obligationId: string, now: Date): Promise<void> {
    const existing = await this.find(kind, obligationId);
    if (existing === undefined) {
      throw new ConflictError(`No x402 payable quote for ${kind}/${obligationId}`, {
        kind,
        obligationId,
      });
    }
    this.#byKey.set(`${kind}:${obligationId}`, { ...existing, status: "settled", updatedAt: now });
  }

  /** A row can be refreshed when nothing is in flight against it. */
  #refreshable(row: PayableQuote | undefined, now: Date): boolean {
    if (row === undefined) return true;
    if (row.status === "quoted" || row.status === "settled") return true;
    return row.expiresAt.getTime() <= now.getTime();
  }
}

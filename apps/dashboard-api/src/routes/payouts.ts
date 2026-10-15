/**
 * Batch payout routes (#295).
 *
 * Behind `require-auth` + `wallets:withdraw`, same as wallets: this moves the
 * merchant's money. Mayarin never signs here — `prepare` returns calldata for
 * the merchant's own wallet (the Safe owner, or any wallet paying from its own
 * balance), and `POST /` records only what the chain confirms.
 */

import { CHAIN_IDS } from "@mayarin/chain";
import { PAYOUT_SOURCES, type PayoutBatch, type PayoutRow, payoutTotals } from "@mayarin/payouts";
import { UnauthorizedError } from "@mayarin/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Container } from "../container.ts";
import { toMoneyDto } from "../dto/money.ts";
import { csrfMiddleware } from "../middleware/csrf.ts";
import type { AuthVars } from "../middleware/types.ts";

/** A payout file is small by construction: 100 rows of an address, an amount and a note. */
const MAX_CSV_BYTES = 64 * 1024;

const requestSchema = z
  .object({
    chain: z.enum(CHAIN_IDS),
    source: z.enum(PAYOUT_SOURCES),
    csv: z.string().max(MAX_CSV_BYTES),
  })
  .strict();

const recordSchema = z
  .object({
    chain: z.enum(CHAIN_IDS),
    source: z.enum(PAYOUT_SOURCES),
    csv: z.string().max(MAX_CSV_BYTES),
    transactionHash: z.string(),
  })
  .strict();

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  cursor: z.string().min(1).optional(),
});

function toRowDto(row: PayoutRow) {
  return {
    line: row.line,
    to: row.to,
    amount: toMoneyDto(row.amount),
    note: row.note ?? null,
  };
}

function toBatchDto(batch: PayoutBatch) {
  return {
    id: batch.id,
    chain: batch.chain,
    sourceAddress: batch.sourceAddress,
    submittedBy: batch.submittedBy,
    transactionHash: batch.transactionHash,
    rows: batch.rows.map(toRowDto),
    totals: payoutTotals(batch.rows).map(toMoneyDto),
    completedAt: batch.completedAt.toISOString(),
  };
}

export function payoutRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  const scopeOf = (c: { get: (key: "scope") => AuthVars["scope"] }) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    return scope;
  };

  app.get("/", async (c) => {
    const query = historyQuerySchema.parse(c.req.query());
    const page = await container.payouts.history(scopeOf(c), {
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    });
    return c.json({ batches: page.items.map(toBatchDto), nextCursor: page.nextCursor });
  });

  /** Parses the file and returns the transaction to sign, or every row error. */
  app.post("/prepare", csrfMiddleware(), async (c) => {
    const body = requestSchema.parse(await c.req.json());
    const prepared = await container.payouts.prepare(scopeOf(c), body);
    return c.json({
      rows: prepared.rows.map(toRowDto),
      errors: prepared.errors,
      totals: prepared.totals.map(toMoneyDto),
      transaction: prepared.transaction ?? null,
      approvals: prepared.approvals.map((approval) => ({
        asset: approval.asset,
        token: approval.token,
        amount: approval.amount.toString(),
        data: approval.data,
      })),
    });
  });

  /** Records a submitted batch once the chain's transfers match every row. */
  app.post("/", csrfMiddleware(), async (c) => {
    const body = recordSchema.parse(await c.req.json());
    const batch = await container.payouts.record(scopeOf(c), body);
    return c.json({ batch: toBatchDto(batch) }, 201);
  });

  return app;
}

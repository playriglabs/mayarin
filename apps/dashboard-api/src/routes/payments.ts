/**
 * Payment routes — merchant/admin scoped reads.
 *
 * Mounted behind `require-auth`, so a verified session and its `Scope` are
 * present. The scope decides what the caller sees; the service enforces the
 * per-payment visibility split. Thin: parse query → call service → map DTO.
 */

import { csvLine, PAYMENT_CSV_COLUMNS, paymentCsvRow } from "@mayarin/documents";
import { UnauthorizedError, ValidationError } from "@mayarin/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Container } from "../container.ts";
import { toPaymentDetailDto, toPaymentIntentDto } from "../dto/payment.ts";
import { csrfMiddleware } from "../middleware/csrf.ts";
import type { AuthVars } from "../middleware/types.ts";
import { safeCallTransaction } from "../services/payout-chain.ts";
import { refreshStream } from "./refresh-stream.ts";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  q: z.string().trim().min(1).optional(),
  status: z
    .enum(["CREATED", "CONFIRMED", "PROCESSING", "COMPLETED", "FAILED", "EXPIRED"])
    .optional(),
  sort: z.enum(["created", "-created", "-amount"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().min(1).optional(),
});

const exportQuerySchema = listQuerySchema.omit({ limit: true, cursor: true });

const refundBodySchema = z.object({ from: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

export function paymentRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  app.get("/events", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");

    return refreshStream(c, "payments");
  });

  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const query = listQuerySchema.parse(c.req.query());
    const page = await container.payments.list(scope, {
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.q === undefined ? {} : { q: query.q }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.sort === undefined ? {} : { sort: query.sort }),
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    });
    return c.json({ payments: page.items.map(toPaymentIntentDto), nextCursor: page.nextCursor });
  });

  /**
   * Every payment the list filters match, as one CSV (#294). Streamed a page at
   * a time; the byte-order mark is what makes Excel read the file as UTF-8.
   */
  app.get("/export.csv", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const query = exportQuerySchema.parse(c.req.query());
    const pages = container.payments.exportPages(scope, {
      ...(query.q === undefined ? {} : { q: query.q }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.sort === undefined ? {} : { sort: query.sort }),
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
    });

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(`\ufeff${csvLine(PAYMENT_CSV_COLUMNS)}`));
        for await (const rows of pages) {
          const chunk = rows.map((row) => csvLine(paymentCsvRow(row.intent, row.transaction)));
          controller.enqueue(encoder.encode(chunk.join("")));
        }
        controller.close();
      },
    });

    const day = new Date().toISOString().slice(0, 10);
    return c.body(body, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payments-${day}.csv"`,
      "Cache-Control": "private, no-store",
    });
  });

  app.get("/:id", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const { intent, transaction, events } = await container.payments.get(scope, c.req.param("id"));
    // The PDFs render on the payment API, public by payment id (#293); the
    // dashboard is handed absolute URLs for the same reason as `qrUrl` below.
    const base = `${container.config.checkoutBaseUrl}/v1/payments/${intent.id}`;
    return c.json({
      ...toPaymentDetailDto(intent, transaction, events),
      documents: {
        invoiceUrl: `${base}/invoice.pdf`,
        receiptUrl: intent.status === "COMPLETED" ? `${base}/receipt.pdf` : null,
      },
    });
  });

  /**
   * What the payer must send, for rendering as a QR (#15).
   *
   * Its own route rather than a field on the detail above: the address is
   * allocated at price lock, so it arrives later than the payment does, and a
   * deposit lookup crosses to the payment API — which owns the token registry
   * that decides an EIP-681 URI's form. Merging the two would make every
   * payment read wait on a second service to answer a question most of them are
   * not asking.
   *
   * Scoped through the same read service as the detail, so another merchant's
   * payment is a 404 here exactly as it is there — and the payment API, which
   * has no session, is only ever asked about an id already checked.
   */
  app.get("/:id/deposit", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const { intent } = await container.payments.get(scope, c.req.param("id"));
    const deposit = await container.paymentApi.deposit(intent.id);

    return c.json({
      deposit,
      /**
       * Where to fetch the rendered code, assembled here rather than in the
       * browser: the renderer lives on the payment API, and a page that builds
       * that address itself has to be told the origin separately — and gets it
       * wrong in exactly the deployment where the two apps are not on one host.
       */
      qrUrl:
        deposit?.uri == null
          ? null
          : `${container.config.checkoutBaseUrl}/checkout/qr?value=${encodeURIComponent(deposit.uri)}`,
    });
  });

  /**
   * An escrowed payment's hold (#304): where the funds are and who may move
   * them. `null` for an ordinary payment, which never asks the payment API.
   */
  app.get("/:id/escrow", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const { intent } = await container.payments.get(scope, c.req.param("id"));
    if (intent.escrow === undefined) return c.json({ escrow: null });
    return c.json({ escrow: await container.paymentApi.escrow(intent.id) });
  });

  /**
   * The refund transaction for the merchant's wallet to send (#304). Mayarin
   * signs nothing: the factory pays back only when the payee — the merchant's
   * address — calls it. A connected wallet that is the payee calls directly;
   * otherwise the payee is the merchant's Safe and `from` is its owner.
   */
  app.post("/:id/escrow/refund", csrfMiddleware(), async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const { from } = refundBodySchema.parse(await c.req.json());
    const { intent } = await container.payments.get(scope, c.req.param("id"));
    if (intent.escrow === undefined) {
      throw new ValidationError("This payment is not held in escrow");
    }
    const escrow = await container.paymentApi.escrow(intent.id);
    const data = escrow.calls.refund as `0x${string}`;
    const transaction =
      from.toLowerCase() === escrow.terms.payee.toLowerCase()
        ? { from: from.toLowerCase(), to: escrow.factory.toLowerCase(), data }
        : safeCallTransaction(escrow.terms.payee, from, escrow.factory, data);
    return c.json({ chainId: escrow.chainId, transaction });
  });

  /**
   * Retries a payment that failed after the payer's funds arrived — a clearing
   * step broke on a config since fixed, and the money sat at the deposit
   * address. The clearing engine replays only what did not happen; it refuses
   * anything that must not be retried, and its refusal is the message the
   * merchant should read.
   *
   * Scoped through the same read service as the detail, so another merchant's
   * payment is a 404 here exactly as it is there — the payment API, which has
   * no session, is only ever asked about an id already checked.
   */
  app.post("/:id/retry", csrfMiddleware(), async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const { intent } = await container.payments.get(scope, c.req.param("id"));
    await container.paymentApi.retry(intent.id);

    // The reopened payment is read back by the invalidated detail query; there
    // is nothing here to hand over that the refetch does not answer fresher.
    return c.json({ retrying: true });
  });

  return app;
}

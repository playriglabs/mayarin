/**
 * Payment status route.
 *
 * One view of a payment, assembled by the payment application service. Accepts
 * either the intent id or the clearing transaction id, since callers hold
 * whichever they were handed.
 */

import {
  type DocumentSources,
  invoiceDocument,
  invoiceIdOf,
  type PaymentDocument,
  receiptDocument,
} from "@mayarin/documents";
import { NotFoundError } from "@mayarin/shared";
import { type Context, Hono } from "hono";
import type { Container } from "../container.ts";
import { toContractCallDto } from "../dto/contract-call.ts";
import { toDepositDto } from "../dto/deposit.ts";
import { toPaymentDto } from "../dto/payment.ts";
import { refundBodySchema, toRefundDto, toRefundSummaryDto } from "../dto/refund.ts";
import { type ApiKeyAuthEnv, requireApiKey } from "../middleware/api-key.ts";
import { renderDocumentPdf } from "../services/document-pdf.ts";

/**
 * Everything the invoice and receipt of one payment are built from (#293).
 *
 * The funding hash is the first confirmed deposit, which is what the
 * deposit-match path has in place of a settlement transaction of its own.
 */
async function documentSources(container: Container, id: string): Promise<DocumentSources> {
  const { intent, transaction, deposit } = await container.paymentApp.getPayment(id);
  const invoiceId = invoiceIdOf(intent);
  const invoice =
    invoiceId === undefined ? undefined : await container.invoices.getInvoice(invoiceId);
  const funding = deposit?.deposits.find((entry) => entry.status === "CONFIRMED");
  return {
    intent,
    transaction,
    ...(invoice === undefined ? {} : { invoice }),
    ...(funding === undefined ? {} : { fundingTxHash: funding.txHash }),
  };
}

async function pdfResponse(c: Context, doc: PaymentDocument): Promise<Response> {
  const bytes = await renderDocumentPdf(doc);
  const name = `${doc.kind}-${doc.invoiceNumber.replace(/[^\w-]/g, "-")}.pdf`;
  return c.body(bytes, 200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${name}"`,
    "Cache-Control": "private, no-store",
  });
}

export function paymentRoutes(container: Container): Hono<ApiKeyAuthEnv> {
  const app = new Hono<ApiKeyAuthEnv>();

  app.get("/:id", async (c) => {
    const { intent, transaction, events, deposit } = await container.paymentApp.getPayment(
      c.req.param("id"),
    );
    const rail = transaction?.deposit;
    // Resolved here rather than inside the DTO: the registry read is async, and
    // a native deposit has no token to look up.
    const token =
      rail === undefined ? undefined : await container.registry.address(rail.asset, rail.chain);
    const depositDto =
      deposit === null || transaction === null
        ? null
        : toDepositDto(
            transaction,
            deposit.deposits,
            deposit.headNumber,
            deposit.requiredConfirmations,
            token,
          );
    return c.json(toPaymentDto(intent, transaction, events, depositDto));
  });

  /**
   * The payment's invoice and receipt as PDFs (#293). Public by unguessable
   * payment id, the same rule as the status read above; the receipt is a 409
   * until the payment has completed.
   */
  app.get("/:id/invoice.pdf", async (c) =>
    pdfResponse(c, invoiceDocument(await documentSources(container, c.req.param("id")))),
  );

  app.get("/:id/receipt.pdf", async (c) =>
    pdfResponse(c, receiptDocument(await documentSources(container, c.req.param("id")))),
  );

  /**
   * Refunds against a settled payment (#12).
   *
   * `POST` is idempotent on `Idempotency-Key`: a retried request returns the
   * refund it made rather than issuing a second one. An omitted amount refunds
   * everything still refundable.
   *
   * Any valid key may refund for now: an intent minted from a QR carries an
   * EMVCo merchant identity, not a Mayarin tenant id, so a tenant match here
   * would refuse every scanned-QR payment. Who may sign a refund is exactly
   * what #12 (on hold) decides — the check lands with it.
   */
  app.post("/:id/refunds", requireApiKey(container.verifyApiKey), async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const body = refundBodySchema.parse(raw);
    const idempotencyKey = c.req.header("Idempotency-Key");

    // The caller holds whichever id they were handed, so resolve through the
    // same view the status route uses rather than assuming a clearing id.
    const { transaction } = await container.paymentApp.getPayment(c.req.param("id"));
    if (transaction === null) {
      throw new NotFoundError("This payment has no clearing transaction to refund", {});
    }

    const refund = await container.refunds.issue({
      clearingTransactionId: transaction.id,
      ...(body.amount === undefined ? {} : { amount: body.amount }),
      ...(body.reason === undefined ? {} : { reason: body.reason }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });

    return c.json({ refund: toRefundDto(refund) }, 201);
  });

  app.get("/:id/refunds", async (c) => {
    const { transaction } = await container.paymentApp.getPayment(c.req.param("id"));
    if (transaction === null) {
      throw new NotFoundError("This payment has no clearing transaction to refund", {});
    }

    const [refunds, summary] = await Promise.all([
      container.refunds.list(transaction.id),
      container.refunds.summary(transaction.id),
    ]);

    return c.json({
      refunds: refunds.map(toRefundDto),
      summary: toRefundSummaryDto(summary),
    });
  });

  /**
   * The contract-path submit payload (#61): the signed order plus a fresh
   * executable route. Fetched per attempt — a route is perishable, so the
   * client asks again rather than reusing an old response.
   */
  app.get("/:id/contract-call", async (c) => {
    const checkout = container.checkout;
    if (checkout === undefined) {
      throw new NotFoundError("The contract execution path is not enabled on this deployment", {});
    }
    return c.json(toContractCallDto(await checkout.contractCall(c.req.param("id"))));
  });

  return app;
}

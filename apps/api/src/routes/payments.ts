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
import { escrowResolveCalldata } from "@mayarin/provider-evm";
import { isMayarinError, NotFoundError, ValidationError } from "@mayarin/shared";
import { type Context, Hono } from "hono";
import type { Container } from "../container.ts";
import { toClearingDto } from "../dto/clearing.ts";
import { toContractCallDto } from "../dto/contract-call-mapper.ts";
import { toDepositDto } from "../dto/deposit.ts";
import { disputeMessageBodySchema } from "../dto/escrow.ts";
import { toDisputeMessageDto, toEscrowDto } from "../dto/escrow-mapper.ts";
import { toPayerPaymentDto, toPaymentDto } from "../dto/payment.ts";
import { refundBodySchema, toRefundDto, toRefundSummaryDto } from "../dto/refund.ts";
import { scopedIdempotencyKey } from "../idempotency.ts";
import { type ApiKeyAuthEnv, requireApiKey } from "../middleware/api-key.ts";
import { PAYER_CALLER, payerAccess } from "../middleware/payer-access.ts";
import { fetchLogo, renderDocumentPdf } from "../services/document-pdf.ts";

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
  const logoUrl = (await container.merchants.findById(intent.merchant.id))?.logoUrl;
  return {
    intent,
    transaction,
    ...(invoice === undefined ? {} : { invoice }),
    ...(funding === undefined ? {} : { fundingTxHash: funding.txHash }),
    ...(logoUrl === undefined ? {} : { merchantLogoUrl: logoUrl }),
  };
}

/** A payment that is not the caller's answers exactly like one that is absent. */
function assertOwner(owner: string | undefined, merchantId: string, id: string): void {
  if (owner !== merchantId) {
    throw new NotFoundError(`Payment ${id} not found`, { id });
  }
}

async function pdfResponse(c: Context, doc: PaymentDocument): Promise<Response> {
  const logo = doc.seller.logoUrl === undefined ? undefined : await fetchLogo(doc.seller.logoUrl);
  const bytes = await renderDocumentPdf(doc, logo);
  const name = `${doc.kind}-${doc.invoiceNumber.replace(/[^\w-]/g, "-")}.pdf`;
  return c.body(bytes, 200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${name}"`,
    "Cache-Control": "private, no-store",
  });
}

export function paymentRoutes(container: Container): Hono<ApiKeyAuthEnv> {
  const app = new Hono<ApiKeyAuthEnv>();

  // A route that acts on one payment by id proves who is asking (SEC-09): the
  // payer's token, the owning merchant's key, or the dashboard API. The refund
  // routes are the merchant's alone and check their own key.
  const access = payerAccess(container);

  app.get("/:id", access, async (c) => {
    const { intent, transaction, events, deposit } = await container.paymentApp.getPayment(
      c.req.param("id"),
    );
    const rail = transaction?.deposit;
    // Resolved here rather than inside the DTO: the registry read is async, and
    // a native deposit has no token to look up. A payer-only token (CAKE, WETH)
    // is not in the stablecoin registry, so `CHAIN_ASSETS` names its contract;
    // without it the payer is shown no code to scan.
    const token =
      rail === undefined
        ? undefined
        : ((await container.registry.address(rail.asset, rail.chain)) ??
          container.config.chainAssets[rail.chain]?.[rail.asset]);
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
    const dto = toPaymentDto(intent, transaction, events, depositDto);
    return c.json(c.get(PAYER_CALLER) === true ? toPayerPaymentDto(dto) : dto);
  });

  /**
   * The payment's invoice and receipt as PDFs (#293). Public by unguessable
   * payment id, the same rule as the status read above; the receipt is a 409
   * until the payment has completed.
   */
  app.get("/:id/invoice.pdf", access, async (c) =>
    pdfResponse(c, invoiceDocument(await documentSources(container, c.req.param("id")))),
  );

  app.get("/:id/receipt.pdf", access, async (c) =>
    pdfResponse(c, receiptDocument(await documentSources(container, c.req.param("id")))),
  );

  /**
   * Refunds against a settled payment (#12).
   *
   * `POST` is idempotent on `Idempotency-Key`: a retried request returns the
   * refund it made rather than issuing a second one. An omitted amount refunds
   * everything still refundable.
   *
   * Only the tenant that owns the payment may refund it (SEC-01). A foreign
   * payment answers 404, like a foreign invoice: the id was not the caller's to
   * know. The idempotency key is scoped to the tenant, so two tenants reusing a
   * key never see each other's refund.
   */
  app.post("/:id/refunds", requireApiKey(container.verifyApiKey, "refunds:manage"), async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const body = refundBodySchema.parse(raw);
    const idempotencyKey = c.req.header("Idempotency-Key");

    // The caller holds whichever id they were handed, so resolve through the
    // same view the status route uses rather than assuming a clearing id.
    const { intent, transaction } = await container.paymentApp.getPayment(c.req.param("id"));
    const { merchantId } = c.get("scope");
    assertOwner(intent.ownerMerchantId, merchantId, c.req.param("id"));
    if (transaction === null) {
      throw new NotFoundError("This payment has no clearing transaction to refund", {});
    }

    const refund = await container.refunds.issue({
      clearingTransactionId: transaction.id,
      ...(body.amount === undefined ? {} : { amount: body.amount }),
      ...(body.reason === undefined ? {} : { reason: body.reason }),
      ...(idempotencyKey === undefined
        ? {}
        : { idempotencyKey: scopedIdempotencyKey(merchantId, "refund", idempotencyKey) }),
    });

    return c.json({ refund: toRefundDto(refund) }, 201);
  });

  app.get("/:id/refunds", requireApiKey(container.verifyApiKey), async (c) => {
    const { intent, transaction } = await container.paymentApp.getPayment(c.req.param("id"));
    assertOwner(intent.ownerMerchantId, c.get("scope").merchantId, c.req.param("id"));
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
   * Retries a payment that failed after the payer's funds arrived — a clearing
   * step broke on something since fixed, a swap pool missing from the config,
   * a settlement asset not yet whitelisted, while the money sat at the deposit
   * address. Reopens it and replays the ordinary steps; each is idempotent per
   * state, so nothing that already happened happens twice.
   *
   * Public by unguessable payment id, the same rule as the status read above:
   * the engine itself refuses what must not be retried — a payment that is not
   * `FAILED`, or whose funds never arrived — and the retry only ever settles to
   * the merchant's own configured destination.
   */
  app.post("/:id/retry", access, async (c) => {
    // The caller holds whichever id they were handed, so resolve through the
    // same view the status route uses rather than assuming a clearing id.
    const { transaction } = await container.paymentApp.getPayment(c.req.param("id"));
    if (transaction === null) {
      throw new NotFoundError("This payment has no clearing transaction to retry", {});
    }

    try {
      const progress = await container.engine.retry(transaction.id);
      return c.json({ clearing: toClearingDto(progress.transaction) });
    } catch (error) {
      // The reopen is persisted before the steps run. A process with no treasury
      // executor (the API's, by design) cannot take a deposit-path payment past
      // `ASSET_RECEIVED` and says so with a retryable error; the chain worker,
      // which holds the executor, finishes it on its next pass. That is accepted
      // work, not a failure to report as a 502.
      if (!isMayarinError(error) || !error.retryable) throw error;
      const reopened = await container.engine.getById(transaction.id);
      return c.json({ clearing: toClearingDto(reopened) }, 202);
    }
  });

  /**
   * The contract-path submit payload (#61): the signed order plus a fresh
   * executable route. Fetched per attempt — a route is perishable, so the
   * client asks again rather than reusing an old response.
   */
  app.get("/:id/contract-call", access, async (c) => {
    const checkout = container.checkout;
    if (checkout === undefined) {
      throw new NotFoundError("The contract execution path is not enabled on this deployment", {});
    }
    return c.json(toContractCallDto(await checkout.contractCall(c.req.param("id"))));
  });

  /**
   * Where an escrowed payment's funds are, and the calldata to move them
   * (#304). Open like `contract-call`: the terms are public on chain anyway,
   * and the factory, not this route, decides who may send each call.
   */
  app.get("/:id/escrow", access, async (c) => {
    const view = await container.escrow.view(c.req.param("id"));
    const standing = await container.payerStanding.standing(view.terms.payer);
    return c.json({ escrow: toEscrowDto(view, standing) });
  });

  /**
   * The arbiter's split of a disputed v2 escrow (#315): `payeeBps` of the
   * payment to the merchant, the rest to the buyer. Calldata only — the
   * arbiter's wallet sends it, and the factory accepts it only from the
   * arbiter, so this is as open as the escrow view.
   */
  app.get("/:id/escrow/resolve", access, async (c) => {
    const payeeBps = Number(c.req.query("payeeBps"));
    if (!Number.isInteger(payeeBps) || payeeBps < 0 || payeeBps > 10_000) {
      throw new ValidationError("payeeBps is a whole number from 0 to 10000", {});
    }
    const view = await container.escrow.view(c.req.param("id"));
    if (view.terms.bond === undefined) {
      throw new ValidationError("This escrow predates split decisions; release or refund it", {});
    }
    return c.json({
      to: view.factory,
      data: escrowResolveCalldata(view.terms, view.token, payeeBps),
    });
  });

  /**
   * The payer's message in their dispute (#313). Open like the escrow view —
   * checkout has no session — so the body carries a signature from the wallet
   * the escrow refunds to, and only that wallet is accepted.
   */
  app.post("/:id/escrow/dispute/messages", access, async (c) => {
    const input = disputeMessageBodySchema.parse(await c.req.json());
    const message = await container.escrow.postPayerMessage(c.req.param("id"), input);
    return c.json({ message: toDisputeMessageDto(message) }, 201);
  });

  return app;
}

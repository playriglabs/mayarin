/**
 * Invoice routes (#112).
 *
 * An invoice is a document with a lifecycle, so the verbs are explicit rather
 * than a single `PATCH` that means different things depending on state:
 * `/issue` allocates a number and freezes the document, `/void` withdraws it,
 * and `/checkout` mints a Payment Intent for what is still owed.
 *
 * `GET /:id` returns the derived figures alongside the stored ones, so a client
 * never re-derives what is owed from the payment list. Two implementations of
 * that sum eventually disagree.
 */

import { Hono } from "hono";
import type { Container } from "../container.ts";
import {
  checkoutInvoiceBodySchema,
  createInvoiceBodySchema,
  editInvoiceBodySchema,
  issueInvoiceBodySchema,
  toEditInvoiceInput,
  toInvoiceDto,
  toInvoiceViewDto,
  toIssueInvoiceCommand,
} from "../dto/invoice.ts";
import { toMerchantSnapshot, toPaymentIntentDto } from "../dto/payment-intent.ts";

export function invoiceRoutes(container: Container): Hono {
  const app = new Hono();
  const baseUrl = container.config.publicBaseUrl;

  app.post("/", async (c) => {
    const body = createInvoiceBodySchema.parse(await c.req.json());
    const idempotencyKey = c.req.header("Idempotency-Key");

    const invoice = await container.invoices.createInvoice({
      merchantId: body.merchantId,
      merchant: toMerchantSnapshot(body.merchant),
      buyer: body.buyer,
      currency: body.currency,
      lines: body.lines,
      ...(body.notes === undefined ? {} : { notes: body.notes }),
      ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });

    return c.json({ invoice: toInvoiceDto(invoice, baseUrl) }, 201);
  });

  app.get("/", async (c) => {
    const state = c.req.query("state");
    const invoices = await container.invoices.listInvoices({
      merchantId: c.req.query("merchantId") ?? "",
      // Passed through unvalidated on purpose: an unknown state matches
      // nothing, which is the honest answer to a filter nobody defined.
      ...(state === undefined ? {} : { state: state as "draft" | "issued" | "void" }),
    });
    return c.json({ invoices: invoices.map((invoice) => toInvoiceDto(invoice, baseUrl)) });
  });

  app.get("/:id", async (c) => {
    const view = await container.invoices.viewInvoice(c.req.param("id"));
    return c.json({ invoice: toInvoiceViewDto(view, baseUrl) });
  });

  app.patch("/:id", async (c) => {
    const body = editInvoiceBodySchema.parse(await c.req.json());
    const invoice = await container.invoices.editInvoice(
      c.req.param("id"),
      toEditInvoiceInput(body),
    );
    return c.json({ invoice: toInvoiceDto(invoice, baseUrl) });
  });

  app.post("/:id/issue", async (c) => {
    const body = issueInvoiceBodySchema.parse(await c.req.json());
    const invoice = await container.invoices.issueInvoice(
      c.req.param("id"),
      toIssueInvoiceCommand(body),
    );
    return c.json({ invoice: toInvoiceDto(invoice, baseUrl) });
  });

  app.post("/:id/void", async (c) => {
    const invoice = await container.invoices.voidInvoice(c.req.param("id"));
    return c.json({ invoice: toInvoiceDto(invoice, baseUrl) });
  });

  app.post("/:id/checkout", async (c) => {
    // A buyer paying the whole balance sends no body, so an absent one is not
    // an error — the same reasoning as a fixed payment link.
    const raw = await c.req.json().catch(() => ({}));
    const body = checkoutInvoiceBodySchema.parse(raw);

    const intent = await container.invoices.checkoutInvoice(c.req.param("id"), {
      ...(body.amount === undefined ? {} : { amount: body.amount }),
    });

    return c.json({ paymentIntent: toPaymentIntentDto(intent) }, 201);
  });

  return app;
}

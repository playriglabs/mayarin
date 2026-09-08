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

import { NotFoundError } from "@mayarin/shared";
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
import { type ApiKeyAuthEnv, assertMerchant, requireApiKey } from "../middleware/api-key.ts";

export function invoiceRoutes(container: Container): Hono<ApiKeyAuthEnv> {
  const app = new Hono<ApiKeyAuthEnv>();
  const baseUrl = container.config.checkoutBaseUrl;
  const auth = requireApiKey(container.verifyApiKey);
  const manage = requireApiKey(container.verifyApiKey, "catalog:manage");

  /**
   * A foreign invoice answers 404, not 403 — the id was not the caller's to
   * know, so the response does not say whether it exists.
   */
  async function ownInvoice(id: string, merchantId: string) {
    const invoice = await container.invoices.getInvoice(id);
    if (invoice.merchantId !== merchantId) {
      throw new NotFoundError(`Invoice ${id} not found`, { id });
    }
    return invoice;
  }

  app.post("/", manage, async (c) => {
    const body = createInvoiceBodySchema.parse(await c.req.json());
    assertMerchant(c.get("scope"), body.merchantId);
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

  // An invoice carries a buyer's name and contact, and the listing is keyed by
  // a guessable merchant id — so it requires a key, and only for the key's own
  // merchant. An omitted `merchantId` means that merchant.
  app.get("/", auth, async (c) => {
    const scope = c.get("scope");
    const merchantId = c.req.query("merchantId") ?? scope.merchantId;
    assertMerchant(scope, merchantId);
    const state = c.req.query("state");
    const invoices = await container.invoices.listInvoices({
      merchantId,
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

  app.patch("/:id", manage, async (c) => {
    await ownInvoice(c.req.param("id"), c.get("scope").merchantId);
    const body = editInvoiceBodySchema.parse(await c.req.json());
    const invoice = await container.invoices.editInvoice(
      c.req.param("id"),
      toEditInvoiceInput(body),
    );
    return c.json({ invoice: toInvoiceDto(invoice, baseUrl) });
  });

  app.post("/:id/issue", manage, async (c) => {
    await ownInvoice(c.req.param("id"), c.get("scope").merchantId);
    const body = issueInvoiceBodySchema.parse(await c.req.json());
    const invoice = await container.invoices.issueInvoice(
      c.req.param("id"),
      toIssueInvoiceCommand(body),
    );
    return c.json({ invoice: toInvoiceDto(invoice, baseUrl) });
  });

  app.post("/:id/void", manage, async (c) => {
    await ownInvoice(c.req.param("id"), c.get("scope").merchantId);
    const invoice = await container.invoices.voidInvoice(c.req.param("id"));
    return c.json({ invoice: toInvoiceDto(invoice, baseUrl) });
  });

  /**
   * The two halves of the discovery opt-in (#273): an invoice the merchant
   * lists appears in the public payable index, an unlisted one stops
   * appearing. `manage` scope, like `/void` — being findable is a decision
   * about the document, and a foreign invoice answers 404 for the same
   * reason.
   */
  app.post("/:id/list", manage, async (c) => {
    await ownInvoice(c.req.param("id"), c.get("scope").merchantId);
    const invoice = await container.invoices.listInvoice(c.req.param("id"));
    return c.json({ invoice: toInvoiceDto(invoice, baseUrl) });
  });

  app.post("/:id/unlist", manage, async (c) => {
    await ownInvoice(c.req.param("id"), c.get("scope").merchantId);
    const invoice = await container.invoices.unlistInvoice(c.req.param("id"));
    return c.json({ invoice: toInvoiceDto(invoice, baseUrl) });
  });

  app.post("/:id/checkout", async (c) => {
    // A buyer paying the whole balance sends no body, so an absent one is not
    // an error — the same reasoning as a fixed payment link.
    const raw = await c.req.json().catch(() => ({}));
    const body = checkoutInvoiceBodySchema.parse(raw);

    const intent = await container.invoices.checkoutInvoice(c.req.param("id"), {
      ...(body.amount === undefined ? {} : { amount: body.amount }),
      ...(body.payment === undefined ? {} : { payment: body.payment }),
      ...(body.executionPath === undefined ? {} : { executionPath: body.executionPath }),
    });

    return c.json({ paymentIntent: toPaymentIntentDto(intent) }, 201);
  });

  return app;
}

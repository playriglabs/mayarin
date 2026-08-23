/**
 * Authenticated merchant invoice management.
 *
 * The public buyer view and checkout remain in `apps/api`, where the clearing
 * stack lives. This surface creates the document in the shared database,
 * issues it, and returns that public URL for the merchant to send.
 */

import type { Merchant } from "@mayarin/auth";
import type { MerchantSnapshot } from "@mayarin/payment-intent";
import {
  InvalidStateTransitionError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import {
  createInvoiceBodySchema,
  issueInvoiceBodySchema,
  sendInvoiceBodySchema,
  toInvoiceViewDto,
} from "../dto/invoices.ts";
import { csrfMiddleware } from "../middleware/csrf.ts";
import type { AuthVars } from "../middleware/types.ts";

function scopeOf(c: { get: (key: "scope") => AuthVars["scope"] }) {
  const scope = c.get("scope");
  if (scope === undefined) throw new UnauthorizedError("Authentication required");
  return scope;
}

function snapshotOf(merchant: Merchant): MerchantSnapshot {
  const { city, countryCode } = merchant;
  if (city === undefined || countryCode === undefined) {
    const missing = [
      ...(city === undefined ? ["city"] : []),
      ...(countryCode === undefined ? ["country"] : []),
    ];
    throw new ValidationError(
      `Set your ${missing.join(" and ")} in settings before generating an invoice`,
      { merchantId: merchant.id, missing },
    );
  }
  return { id: merchant.id, name: merchant.name, city, countryCode };
}

export function invoiceRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();
  const checkoutBaseUrl = container.config.checkoutBaseUrl;

  async function ownInvoice(id: string, merchantId: string) {
    const invoice = await container.invoices.getInvoice(id);
    if (invoice.merchantId !== merchantId) {
      throw new NotFoundError(`Invoice ${id} not found`, { id });
    }
    return invoice;
  }

  app.get("/", async (c) => {
    const scope = scopeOf(c);
    const invoices = await container.invoices.listInvoices({
      merchantId: scope.merchantId,
      limit: 200,
    });
    const views = await Promise.all(
      invoices.map((invoice) => container.invoices.viewInvoice(invoice.id)),
    );
    return c.json({ invoices: views.map((view) => toInvoiceViewDto(view, checkoutBaseUrl)) });
  });

  app.post("/", csrfMiddleware(), async (c) => {
    const scope = scopeOf(c);
    const body = createInvoiceBodySchema.parse(await c.req.json());
    const merchant = await container.settings.get(scope);
    const draft = await container.invoices.createInvoice({
      merchantId: scope.merchantId,
      merchant: snapshotOf(merchant),
      buyer: body.buyer,
      currency: body.currency,
      lines: body.lines,
      ...(body.notes === undefined || body.notes === "" ? {} : { notes: body.notes }),
    });
    const invoice = await container.invoices.issueInvoice(draft.id, {
      dueAt: body.dueAt,
      format: { prefix: "INV", includeYear: true },
    });
    const view = await container.invoices.viewInvoice(invoice.id);
    return c.json({ invoice: toInvoiceViewDto(view, checkoutBaseUrl) }, 201);
  });

  app.get("/:id", async (c) => {
    const scope = scopeOf(c);
    await ownInvoice(c.req.param("id"), scope.merchantId);
    const view = await container.invoices.viewInvoice(c.req.param("id"));
    return c.json({ invoice: toInvoiceViewDto(view, checkoutBaseUrl) });
  });

  app.post("/:id/issue", csrfMiddleware(), async (c) => {
    const scope = scopeOf(c);
    await ownInvoice(c.req.param("id"), scope.merchantId);
    const body = issueInvoiceBodySchema.parse(await c.req.json());
    const invoice = await container.invoices.issueInvoice(c.req.param("id"), {
      dueAt: body.dueAt,
      format: { prefix: "INV", includeYear: true },
    });
    const view = await container.invoices.viewInvoice(invoice.id);
    return c.json({ invoice: toInvoiceViewDto(view, checkoutBaseUrl) });
  });

  app.post("/:id/void", csrfMiddleware(), async (c) => {
    const scope = scopeOf(c);
    await ownInvoice(c.req.param("id"), scope.merchantId);
    const invoice = await container.invoices.voidInvoice(c.req.param("id"));
    const view = await container.invoices.viewInvoice(invoice.id);
    return c.json({ invoice: toInvoiceViewDto(view, checkoutBaseUrl) });
  });

  app.post("/:id/send", csrfMiddleware(), async (c) => {
    const scope = scopeOf(c);
    const body = sendInvoiceBodySchema.parse(await c.req.json());
    const invoice = await ownInvoice(c.req.param("id"), scope.merchantId);
    if (invoice.state !== "issued" || invoice.number === undefined) {
      throw new InvalidStateTransitionError("Only an issued invoice can be emailed", {
        id: invoice.id,
        state: invoice.state,
      });
    }
    const buyerEmail = invoice.buyer.email;
    if (buyerEmail === undefined) {
      throw new ValidationError("This invoice has no client email address", { id: invoice.id });
    }

    const view = await container.invoices.viewInvoice(invoice.id);
    const dto = toInvoiceViewDto(view, checkoutBaseUrl);
    const delivery = await container.invoiceEmails.sendInvoice({
      invoiceId: invoice.id,
      deliveryId: body.deliveryId,
      invoiceNumber: invoice.number,
      merchantName: invoice.merchant.name,
      buyerName: invoice.buyer.name,
      buyerEmail,
      total: dto.total.display,
      outstanding: dto.outstanding.display,
      dueAt: dto.dueAt,
      url: dto.url,
    });
    return c.json({ delivery });
  });

  return app;
}

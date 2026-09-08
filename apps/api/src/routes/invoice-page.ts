/**
 * Hosted invoice page (#112, #151).
 *
 * One page that serves two readers. On screen a buyer sees what is owed and a
 * button that mints a Payment Intent for it. On paper — the same URL, printed —
 * a finance team sees a document they can file: number, dates, both parties,
 * line items, and what has been paid.
 *
 * Rendering is the checkout UI SPA (`apps/checkout-ui`); this route injects the
 * invoice view into the shell as a `window.__BOOTSTRAP__` payload. The
 * printable view stays `@media print` in the SPA's stylesheet rather than a
 * second route, so the printed page can never drift from the one the buyer
 * looked at.
 */

import type { InvoiceView } from "@mayarin/invoicing";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import { toInvoicePaymentDto } from "../dto/invoice.ts";
import { toMoneyDto } from "../dto/money.ts";
import type { RailDto } from "../dto/rails.ts";
import { payerRails } from "../rails.ts";
import { renderShell, requestOrigin } from "../services/checkout-shell.ts";

export function invoicePageRoutes(container: Container): Hono {
  const app = new Hono();
  const distDir = container.config.checkoutUiDist;

  app.get("/:id/view", async (c) => {
    const view = await container.invoices.viewInvoice(c.req.param("id"));
    // The same rail catalog the hosted checkout reads (#244), so an invoice
    // cannot offer a pair the link page would refuse — ranked the same way
    // (#260), so it cannot offer an order the link page would not either.
    const report = await container.rails.describe(view.invoice.merchantId);
    const origin = requestOrigin((name) => c.req.header(name), container.config.publicBaseUrl);
    return c.html(
      await renderShell(
        distDir,
        invoiceBootstrap(
          view,
          `${origin}/v1/invoices/${view.invoice.id}/checkout`,
          await payerRails(container, report),
        ),
      ),
    );
  });

  return app;
}

/**
 * The invoice page's bootstrap, mirrored by `apps/checkout-ui/src/features/invoice/types.ts`.
 *
 * Line totals are computed here, not in the browser: money is bigint minor
 * units, and the SPA renders `display` strings without ever doing arithmetic.
 */
function invoiceBootstrap(view: InvoiceView, checkoutUrl: string, rails: readonly RailDto[]) {
  const { invoice, status, paid, outstanding, payments } = view;
  return {
    page: "invoice",
    invoiceId: invoice.id,
    number: invoice.number ?? null,
    status,
    merchant: { name: invoice.merchant.name, city: invoice.merchant.city },
    buyer: {
      name: invoice.buyer.name,
      email: invoice.buyer.email ?? null,
      taxId: invoice.buyer.taxId ?? null,
      address: invoice.buyer.address ?? null,
    },
    lines: invoice.lines.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      unitPrice: toMoneyDto(line.unitPrice),
      lineTotal: toMoneyDto({
        amount: line.unitPrice.amount * BigInt(line.quantity),
        asset: line.unitPrice.asset,
      }),
    })),
    total: toMoneyDto(invoice.total),
    paid: toMoneyDto(paid),
    outstanding: toMoneyDto(outstanding),
    notes: invoice.notes ?? null,
    issuedAt: invoice.issuedAt?.toISOString() ?? null,
    dueAt: invoice.dueAt?.toISOString() ?? null,
    payable: status !== "void" && status !== "draft" && outstanding.amount > 0n,
    rails,
    /**
     * What was paid, and on what. A paid document that names only a figure
     * makes a buyer open a block explorer to answer "did my USDC on Arc land
     * against this invoice"; the rail is the answer, so the document carries it.
     */
    payments: payments.map(toInvoicePaymentDto),
    checkoutUrl,
  };
}

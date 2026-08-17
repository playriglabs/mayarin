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
import { toMoneyDto } from "../dto/money.ts";
import { renderShell, requestOrigin } from "../services/checkout-shell.ts";
import { defaultPayerAssets, depositChain } from "./checkout-page.ts";

export function invoicePageRoutes(container: Container): Hono {
  const app = new Hono();
  const distDir = container.config.checkoutUiDist;

  app.get("/:id/view", async (c) => {
    const view = await container.invoices.viewInvoice(c.req.param("id"));
    const policy = await container.merchantPolicies.policyFor(view.invoice.merchantId);
    const accepted =
      policy?.acceptedAssets.length !== undefined && policy.acceptedAssets.length > 0
        ? policy.acceptedAssets
        : defaultPayerAssets(container);
    const origin = requestOrigin((name) => c.req.header(name), container.config.publicBaseUrl);
    return c.html(
      await renderShell(
        distDir,
        invoiceBootstrap(
          view,
          `${origin}/v1/invoices/${view.invoice.id}/checkout`,
          accepted,
          depositChain(container),
        ),
      ),
    );
  });

  return app;
}

/**
 * The invoice page's bootstrap, mirrored by `apps/checkout-ui/src/types.ts`.
 *
 * Line totals are computed here, not in the browser: money is bigint minor
 * units, and the SPA renders `display` strings without ever doing arithmetic.
 */
function invoiceBootstrap(
  view: InvoiceView,
  checkoutUrl: string,
  accepted: readonly string[],
  chain: string,
) {
  const { invoice, status, paid, outstanding } = view;
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
    accepted,
    chain,
    checkoutUrl,
  };
}

import { chainLabel } from "@mayarin/chain";
import clsx from "clsx";
import { useState } from "react";
import { Brand } from "../../shared/brand.tsx";
import { BuyerProtection, railBody } from "../../shared/buyer-protection.tsx";
import { PoweredBy } from "../../shared/powered-by.tsx";
import { RailMark } from "../../shared/rail-mark.tsx";
import { RailPicker, railSummary } from "../../shared/rail-picker.tsx";
import { canContinueWithQuote, useQuoteEstimate } from "../link/use-quote-estimate.ts";
import { dateLine, paidOn, STATUS_LABEL, STATUS_TONE } from "./invoice-status.ts";
import { PaidMark } from "./paid-mark.tsx";
import type { InvoiceBootstrap, InvoicePaymentRecord } from "./types.ts";

/**
 * One page that serves two readers. On screen a buyer sees what is owed and a
 * button that mints a Payment Intent for it. On paper — the same URL, printed —
 * a finance team sees a document they can file. The printable view is
 * `@media print` in the shared stylesheet, never a second route, so the printed
 * page cannot drift from the one the buyer looked at.
 */
export function InvoicePage({ bootstrap }: { readonly bootstrap: InvoiceBootstrap }) {
  const { status, buyer, lines, payable, payments } = bootstrap;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rail, setRail] = useState(bootstrap.rails[0]);
  const [payerAddress, setPayerAddress] = useState<string | null>(null);

  // The outstanding balance in the asset the payer picked, from the same rate
  // source the lock reads — so "Pay Rp 49.000" also says how much PYUSD that is.
  const estimate = useQuoteEstimate(
    bootstrap.outstanding.formatted,
    bootstrap.outstanding.asset,
    payable ? rail : undefined,
  );
  const quoteReady = canContinueWithQuote(estimate);

  async function pay() {
    if (rail === undefined || !quoteReady || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(bootstrap.checkoutUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payment: railBody(rail, bootstrap.protection, payerAddress),
          executionPath: "deposit-match",
        }),
      });
      const created = await response.json();
      if (!response.ok) {
        setError(created?.error?.message ?? "Unable to start the payment");
        setBusy(false);
        return;
      }
      const confirmation = await fetch(`/v1/payment-intents/${created.paymentIntent.id}/confirm`, {
        method: "POST",
      });
      const confirmed = await confirmation.json();
      if (!confirmation.ok || confirmed?.paymentIntent?.status === "FAILED") {
        setError(
          confirmed?.error?.message ??
            confirmed?.paymentIntent?.failureReason ??
            "The price could not be locked",
        );
        setBusy(false);
        return;
      }
      location.href = `/checkout/pay/${created.paymentIntent.id}`;
    } catch {
      setError("Network error. Please try again.");
      setBusy(false);
    }
  }

  const invoiceDocument = (
    <>
      <Brand />
      <header className="invoice-head">
        <div>
          <h1>Invoice {bootstrap.number ?? "(draft)"}</h1>
          <p className="muted">{dateLine(bootstrap.issuedAt, bootstrap.dueAt)}</p>
        </div>
        <div>
          <p className={clsx("badge", STATUS_TONE[status])}>
            {/* The tick is read before the word is. Only for a document that
                is actually settled — a part payment is not a receipt. */}
            {status === "paid" && <PaidMark />}
            {STATUS_LABEL[status]}
          </p>
        </div>
      </header>

      <div className="parties">
        <dl className="party">
          <dt>From</dt>
          <dd>{bootstrap.merchant.name}</dd>
          <dd className="muted">{bootstrap.merchant.city}</dd>
        </dl>
        <dl className="party">
          <dt>Bill to</dt>
          <dd>{buyer.name}</dd>
          {buyer.address !== null && <dd className="muted">{buyer.address}</dd>}
          {buyer.taxId !== null && <dd className="muted">Tax ID {buyer.taxId}</dd>}
          {buyer.email !== null && <dd className="muted">{buyer.email}</dd>}
        </dl>
      </div>

      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th className="num">Quantity</th>
            <th className="num">Unit price</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            // Index keys are safe here: the document is frozen, lines never reorder.
            // biome-ignore lint/suspicious/noArrayIndexKey: static document
            <tr key={index}>
              <td>{line.name}</td>
              <td className="num">{line.quantity}</td>
              <td className="num">{line.unitPrice.display}</td>
              <td className="num">{line.lineTotal.display}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>Total</td>
            <td className="num total">{bootstrap.total.display}</td>
          </tr>
          <tr>
            <td colSpan={3} className="muted">
              Amount paid
            </td>
            <td className="num muted">{bootstrap.paid.display}</td>
          </tr>
          <tr>
            <td colSpan={3}>Amount due</td>
            <td className="num total">{bootstrap.outstanding.display}</td>
          </tr>
        </tfoot>
      </table>

      {payments.length > 0 && <Settled payments={payments} />}

      {bootstrap.notes !== null && <p className="notes muted">{bootstrap.notes}</p>}
    </>
  );

  // A paid or void invoice is a document and nothing else: one column.
  if (!payable) {
    return (
      <main className="document">
        {invoiceDocument}
        <PoweredBy className="powered-by mx-auto mt-6 block" />
      </main>
    );
  }

  // Something is owed: the document on the left, the payment on the right —
  // the same split the payment-link page uses. Stacked below the xl width, and
  // printed as the document alone (the panel is screen only).
  return (
    <main className="checkout-shell invoice-shell">
      <section className="checkout-summary invoice-document" aria-label="Invoice">
        <div className="summary-inner">{invoiceDocument}</div>
      </section>
      <section className="checkout-panel screen-only" aria-labelledby="invoice-pay-title">
        <div className="payment-form">
          <p className="section-kicker">Secure checkout</p>
          <h2 id="invoice-pay-title">Pay this invoice</h2>
          <p className="panel-intro">
            {bootstrap.rails.length === 1
              ? `Payable with ${railSummary(rail)}.`
              : "Choose the asset and network you hold."}
          </p>

          <RailPicker rails={bootstrap.rails} selected={rail} onSelect={setRail} />

          {rail !== undefined && (
            <div
              className="payment-estimate"
              aria-busy={estimate.status === "loading"}
              aria-live="polite"
            >
              <span>Estimated total in {rail.asset}</span>
              <strong>{estimate.display}</strong>
            </div>
          )}
          {estimate.status === "unavailable" && (
            <p className="quote-error" role="alert">
              {estimate.message}
            </p>
          )}

          <BuyerProtection
            protection={bootstrap.protection}
            rail={rail}
            payerAddress={payerAddress}
            onPayerAddress={setPayerAddress}
          />

          <p className="checkout-note">
            The exact amount is locked on the next step, and you send{" "}
            <strong>{railSummary(rail)}</strong> to the address shown there.
          </p>
          <button
            type="button"
            className="primary"
            disabled={busy || rail === undefined || !quoteReady}
            onClick={() => void pay()}
          >
            {busy
              ? "Preparing payment…"
              : estimate.status === "unavailable"
                ? "Payment unavailable"
                : `Pay ${bootstrap.outstanding.display}`}
          </button>
          {error !== "" && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <PoweredBy className="powered-by mx-auto mt-6 block" />
        </div>
      </section>
    </main>
  );
}

/**
 * What the invoice was paid with — asset and chain, per payment.
 *
 * Printed as well as shown: it is the half of the receipt a finance team
 * reconciling several chains actually needs, and a document that says only
 * "Paid" sends them to a block explorer to find out which USDC on which network
 * cleared it. A part-paid invoice lists each payment in the order it arrived,
 * which is also why the figures live here rather than in one summary line.
 */
function Settled({ payments }: { readonly payments: readonly InvoicePaymentRecord[] }) {
  return (
    <section className="settled">
      <h2 className="settled-title">
        <PaidMark size={13} />
        Paid with
      </h2>
      <ul className="settled-list">
        {payments.map((payment) => (
          <li key={payment.intentId} className="settled-row">
            <span className="settled-rail">
              {payment.rail === null ? (
                // A fiat-only intent has no chain to name, and naming one it did
                // not settle on would be worse than saying nothing.
                <span>Off-chain</span>
              ) : (
                <>
                  <RailMark asset={payment.rail.asset} chain={payment.rail.chain} size={28} />
                  <span className="settled-asset">{payment.rail.asset}</span>
                  <span className="muted">on {chainLabel(payment.rail.chain)}</span>
                </>
              )}
            </span>
            <span className="settled-meta">
              <strong>{payment.amount.display}</strong>
              <span className="muted">{paidOn(payment.paidAt)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

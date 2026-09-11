import { chainLabel } from "@mayarin/chain";
import clsx from "clsx";
import { useState } from "react";
import { Brand } from "../../shared/brand.tsx";
import { ChainLabel } from "../../shared/chain-logo.tsx";
import { PoweredBy } from "../../shared/powered-by.tsx";
import { RailMark } from "../../shared/rail-mark.tsx";
import { RailPicker } from "../../shared/rail-picker.tsx";
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
  const [rail, setRail] = useState(bootstrap.rails[0]);

  async function pay() {
    if (rail === undefined) return;
    setBusy(true);
    try {
      const response = await fetch(bootstrap.checkoutUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payment: { asset: rail.asset, chain: rail.chain },
          executionPath: "deposit-match",
        }),
      });
      if (!response.ok) {
        setBusy(false);
        return;
      }
      const { paymentIntent } = await response.json();
      const confirmation = await fetch(`/v1/payment-intents/${paymentIntent.id}/confirm`, {
        method: "POST",
      });
      if (!confirmation.ok) {
        setBusy(false);
        return;
      }
      location.href = `/checkout/pay/${paymentIntent.id}`;
    } catch {
      setBusy(false);
    }
  }

  return (
    <main className="document">
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

      <div className="detail-strip">
        <dl className="party">
          <dt>Recipient</dt>
          <dd className="muted">{buyer.email ?? buyer.name}</dd>
        </dl>
        {/* The rail the payer has chosen in "Pay with", so the strip follows
            the dropdown. Screen only — a printed document records what was
            paid, not what could have been. */}
        {payable && rail !== undefined && (
          <dl className="party screen-only">
            <dt>Payment method</dt>
            <dd className="payment-method">
              <RailMark asset={rail.asset} chain={rail.chain} size={30} />
              <span className="rail-picker-copy">
                <strong>{rail.asset}</strong>
                <span>{chainLabel(rail.chain)}</span>
              </span>
            </dd>
          </dl>
        )}
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

      {payable && (
        <>
          <RailPicker
            rails={bootstrap.rails}
            selected={rail}
            onSelect={setRail}
            className="screen-only"
          />
          {/* One rail asks nothing, so the page states it instead of hiding it. */}
          {bootstrap.rails.length === 1 && (
            <p className="rail-note screen-only">
              Payable with {rail?.asset} on <ChainLabel chain={rail?.chain ?? ""} size={18} />.
            </p>
          )}
        </>
      )}

      {/* Only while there is something to pay. A disabled button reading
          "Paid" is a control that cannot be used pretending to be one that
          can — the badge and the receipt above already say what happened. */}
      {payable && (
        <button
          type="button"
          className="primary"
          disabled={busy || rail === undefined}
          onClick={() => void pay()}
        >
          Pay {bootstrap.outstanding.display}
        </button>
      )}
      <PoweredBy className="powered-by mx-auto mt-6 block" />
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

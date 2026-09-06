import { useState } from "react";
import { Brand } from "../../shared/brand.tsx";
import { ChainLabel } from "../../shared/chain-logo.tsx";
import { PoweredBy } from "../../shared/powered-by.tsx";
import { RailPicker } from "../../shared/rail-picker.tsx";
import { dateLine, STATUS_LABEL, STATUS_TONE } from "./invoice-status.ts";
import type { InvoiceBootstrap } from "./types.ts";

/**
 * One page that serves two readers. On screen a buyer sees what is owed and a
 * button that mints a Payment Intent for it. On paper — the same URL, printed —
 * a finance team sees a document they can file. The printable view is
 * `@media print` in the shared stylesheet, never a second route, so the printed
 * page cannot drift from the one the buyer looked at.
 */
export function InvoicePage({ bootstrap }: { readonly bootstrap: InvoiceBootstrap }) {
  const { status, buyer, lines, payable } = bootstrap;
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
          <p className={`badge ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</p>
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

      <button
        type="button"
        className="primary"
        disabled={!payable || busy || rail === undefined}
        onClick={() => void pay()}
      >
        {payable ? `Pay ${bootstrap.outstanding.display}` : STATUS_LABEL[status]}
      </button>
      <PoweredBy className="powered-by mx-auto mt-6 block" />
    </main>
  );
}

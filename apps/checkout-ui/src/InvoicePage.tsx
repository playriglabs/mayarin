import { useState } from "react";
import { AssetLogo } from "./AssetLogo.tsx";
import { Brand } from "./Brand.tsx";
import type { InvoiceBootstrap, InvoiceStatus } from "./types.ts";

const STATUS_LABEL: Readonly<Record<InvoiceStatus, string>> = {
  draft: "Draft",
  issued: "Unpaid",
  partially_paid: "Partially paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

/** Only these two carry a warning colour. The rest are ordinary states. */
const STATUS_TONE: Readonly<Record<InvoiceStatus, string>> = {
  draft: "muted",
  issued: "muted",
  partially_paid: "warn",
  paid: "ok",
  overdue: "warn",
  void: "muted",
};

const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "Asia/Jakarta" });

/** The issued/due line. An absent date is said in words, never as a dash. */
function dateLine(issuedAt: string | null, dueAt: string | null): string {
  const parts = [
    issuedAt === null ? undefined : `Issued ${DATE.format(new Date(issuedAt))}`,
    dueAt === null ? undefined : `Due ${DATE.format(new Date(dueAt))}`,
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? "Not yet issued" : parts.join(" · ");
}

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
  const [asset, setAsset] = useState<string | undefined>(bootstrap.accepted[0]);

  async function pay() {
    if (asset === undefined) return;
    setBusy(true);
    try {
      const response = await fetch(bootstrap.checkoutUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payment: { asset, chain: bootstrap.chain },
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
        <div className="form-block screen-only">
          <span className="label">Pay with</span>
          <div className="assets">
            {bootstrap.accepted.map((choice) => (
              <button
                type="button"
                className="asset"
                key={choice}
                aria-pressed={choice === asset}
                onClick={() => setAsset(choice)}
              >
                <AssetLogo symbol={choice} />
                {choice}
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        className="primary"
        disabled={!payable || busy || asset === undefined}
        onClick={() => void pay()}
      >
        {payable ? `Pay ${bootstrap.outstanding.display}` : STATUS_LABEL[status]}
      </button>
      <a
        className="powered-by mx-auto mt-6 block"
        href="https://mayarin.xyz"
        target="_blank"
        rel="noreferrer"
      >
        Powered by <strong>mayarin.xyz</strong>
      </a>
    </main>
  );
}

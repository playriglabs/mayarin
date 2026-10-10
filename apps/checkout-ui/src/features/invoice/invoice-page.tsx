import { chainLabel } from "@mayarin/chain";
import clsx from "clsx";
import { useState } from "react";
import { Brand } from "../../shared/brand.tsx";
import { BuyerProtection, railBody } from "../../shared/buyer-protection.tsx";
import { CheckoutShell, TestnetBanner } from "../../shared/checkout-shell.tsx";
import { CheckoutSummary, type SummaryRow } from "../../shared/checkout-summary.tsx";
import { PoweredBy } from "../../shared/powered-by.tsx";
import { RailMark } from "../../shared/rail-mark.tsx";
import { RailPicker, railSummary } from "../../shared/rail-picker.tsx";
import {
  errorText,
  estimateRow,
  noteText,
  panelIntro,
  panelTitle,
  primaryButton,
} from "../../shared/ui.ts";
import { canContinueWithQuote, useQuoteEstimate } from "../link/use-quote-estimate.ts";
import { dateLine, paidOn, STATUS_LABEL, STATUS_TONE, shortDate } from "./invoice-status.ts";
import { PaidMark } from "./paid-mark.tsx";
import type { InvoiceBootstrap, InvoicePaymentRecord, SubscriptionInterval } from "./types.ts";

const INTERVAL_SUFFIX: Record<SubscriptionInterval, string> = {
  week: "/ wk",
  month: "/ mo",
  year: "/ yr",
};

const INTERVAL_ROW: Record<SubscriptionInterval, string> = {
  week: "Weekly",
  month: "Monthly",
  year: "Yearly",
};

/**
 * One page that serves two readers. While something is owed, a buyer sees the
 * same checkout every payment uses — a subscription's cycle priced as a plan —
 * and a button that mints a Payment Intent for it. Once paid or void, the same
 * URL is the document a finance team files, on screen and on paper. The printable view is the
 * same markup with `print:` classes, never a second route, so the printed page
 * cannot drift from the one the buyer looked at.
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

  const cell = "border-b border-line py-2.5 text-left";
  const num = "text-right whitespace-nowrap tabular-nums";
  const head = `${cell} text-[11px] font-normal tracking-wide text-muted uppercase`;

  const invoiceDocument = (
    <>
      <Brand merchant={bootstrap.merchant} />
      <header className="mt-8 flex flex-wrap justify-between gap-4 border-b border-line pb-5">
        <div>
          <h1 className="m-0 text-2xl font-normal">Invoice {bootstrap.number ?? "(draft)"}</h1>
          <p className="mt-1 mb-0 text-xs text-muted">
            {dateLine(bootstrap.issuedAt, bootstrap.dueAt)}
          </p>
        </div>
        <div>
          {/* A pill, not a bare word: the status is the first thing a reader
              looks for on an invoice. */}
          <p
            className={clsx(
              "m-0 inline-flex items-center gap-1.5 rounded-full border border-current/25 px-2.5 py-1 text-xs tracking-wide uppercase",
              STATUS_TONE[status],
            )}
          >
            {/* The tick is read before the word is. Only for a document that
                is actually settled — a part payment is not a receipt. */}
            {status === "paid" && <PaidMark />}
            {STATUS_LABEL[status]}
          </p>
        </div>
      </header>

      <div className="my-6 flex flex-wrap gap-8">
        <dl className="m-0 min-w-48">
          <dt className="mb-1 text-[11px] tracking-wide text-muted uppercase">From</dt>
          <dd className="m-0">{bootstrap.merchant.name}</dd>
          <dd className="m-0 text-muted">{bootstrap.merchant.city}</dd>
        </dl>
        <dl className="m-0 min-w-48">
          <dt className="mb-1 text-[11px] tracking-wide text-muted uppercase">Bill to</dt>
          <dd className="m-0">{buyer.name}</dd>
          {buyer.address !== null && <dd className="m-0 text-muted">{buyer.address}</dd>}
          {buyer.taxId !== null && <dd className="m-0 text-muted">Tax ID {buyer.taxId}</dd>}
          {buyer.email !== null && <dd className="m-0 text-muted">{buyer.email}</dd>}
        </dl>
      </div>

      <table className="mt-2 w-full border-collapse">
        <thead>
          <tr>
            <th className={head}>Description</th>
            <th className={`${head} ${num}`}>Quantity</th>
            <th className={`${head} ${num}`}>Unit price</th>
            <th className={`${head} ${num}`}>Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            // Index keys are safe here: the document is frozen, lines never reorder.
            // biome-ignore lint/suspicious/noArrayIndexKey: static document
            <tr key={index}>
              <td className={cell}>{line.name}</td>
              <td className={`${cell} ${num}`}>{line.quantity}</td>
              <td className={`${cell} ${num}`}>{line.unitPrice.display}</td>
              <td className={`${cell} ${num}`}>{line.lineTotal.display}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="pt-3">
              Total
            </td>
            <td className={`pt-3 text-[15px] ${num}`}>{bootstrap.total.display}</td>
          </tr>
          <tr>
            <td colSpan={3} className="pt-1.5 text-muted">
              Amount paid
            </td>
            <td className={`pt-1.5 text-muted ${num}`}>{bootstrap.paid.display}</td>
          </tr>
          <tr>
            <td colSpan={3} className="pt-1.5">
              Amount due
            </td>
            <td className={`pt-1.5 text-[15px] ${num}`}>{bootstrap.outstanding.display}</td>
          </tr>
        </tfoot>
      </table>

      {payments.length > 0 && <Settled payments={payments} />}

      {bootstrap.notes !== null && (
        <p className="mt-6 mb-0 whitespace-pre-wrap text-muted">{bootstrap.notes}</p>
      )}
    </>
  );

  // A paid or void invoice is a document and nothing else: one column, in the
  // middle of the screen. `min-h` so a long invoice still grows and scrolls.
  if (!payable) {
    return (
      <div className="flex min-h-dvh flex-col">
        <TestnetBanner />
        <main
          aria-label="Invoice"
          className="flex flex-1 flex-col items-center justify-center bg-page px-5 py-12 print:block print:bg-white print:p-0"
        >
          <div className="w-full max-w-3xl print:max-w-none">{invoiceDocument}</div>
          <PoweredBy className="mt-10 print:hidden" />
        </main>
      </div>
    );
  }

  // Something is owed: the same checkout every payment uses — the order on the
  // left, the payment on the right. A subscription's cycle reads as a plan,
  // "Rp 99.000 / mo", rather than as a document with one line on it.
  const interval = bootstrap.subscription?.interval;
  const plan = interval !== undefined && lines.length === 1;
  const breakdown: SummaryRow[] = [{ label: "Subtotal", value: bootstrap.total.display }];
  if (bootstrap.paid.amount !== "0") {
    breakdown.push({ label: "Amount paid", value: bootstrap.paid.display });
  }
  breakdown.push({
    label: interval === undefined ? "Amount due" : INTERVAL_ROW[interval],
    value: bootstrap.outstanding.display,
  });
  const details: SummaryRow[] = [
    { label: "Invoice", value: bootstrap.number ?? "(draft)" },
    { label: "Billed to", value: buyer.name },
  ];
  if (buyer.taxId !== null) details.push({ label: "Tax ID", value: buyer.taxId });
  // An absent date is said in words, never as a dash.
  if (bootstrap.dueAt !== null) {
    details.push({ label: "Due", value: shortDate(bootstrap.dueAt) });
  } else if (bootstrap.issuedAt === null) {
    details.push({ label: "Issued", value: "Not yet issued" });
  }

  return (
    <CheckoutShell
      label="Pay this invoice"
      summary={
        <CheckoutSummary
          label="Invoice"
          // The merchant's name alone: an invoice's dates already fill the line
          // under the price, and the city adds nothing a payer needs here.
          merchant={{ ...bootstrap.merchant, city: "" }}
          title={
            plan ? (lines[0]?.name ?? "Subscription") : `Invoice ${bootstrap.number ?? "(draft)"}`
          }
          totalDisplay={bootstrap.outstanding.display}
          {...(interval === undefined ? {} : { priceSuffix: INTERVAL_SUFFIX[interval] })}
          details={details}
          // A plan is its own line; listing it again under the price says it twice.
          lines={
            plan ? null : lines.map((line) => ({ ...line, description: null, imageUrl: null }))
          }
          breakdown={breakdown}
        >
          {payments.length > 0 && <Settled payments={payments} />}
        </CheckoutSummary>
      }
    >
      <h2 className={panelTitle}>Pay this invoice</h2>
      <p className={panelIntro}>
        {bootstrap.rails.length === 1
          ? `Payable with ${railSummary(rail)}.`
          : "Choose the asset and network you hold."}
      </p>

      <RailPicker rails={bootstrap.rails} selected={rail} onSelect={setRail} />

      {rail !== undefined && (
        <div className={estimateRow} aria-busy={estimate.status === "loading"} aria-live="polite">
          <span>Estimated total in {rail.asset}</span>
          <strong>{estimate.display}</strong>
        </div>
      )}
      {estimate.status === "unavailable" && (
        <p className={errorText} role="alert">
          {estimate.message}
        </p>
      )}

      <BuyerProtection
        protection={bootstrap.protection}
        rail={rail}
        payerAddress={payerAddress}
        onPayerAddress={setPayerAddress}
      />

      <button
        type="button"
        className={primaryButton}
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
        <p className={errorText} role="alert">
          {error}
        </p>
      )}
      <p className={`${noteText} text-center`}>
        The exact amount is locked on the next step, and you send{" "}
        <strong className="font-medium text-ink">{railSummary(rail)}</strong> to the address shown
        there.
      </p>
    </CheckoutShell>
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
    <section className="mt-6 rounded-2xl border border-line p-4">
      <h2 className="m-0 inline-flex items-center gap-1.5 text-[11px] tracking-wide text-brand uppercase">
        <PaidMark size={13} />
        Paid with
      </h2>
      <ul className="mt-3 mb-0 grid list-none gap-2.5 p-0">
        {payments.map((payment) => (
          <li
            key={payment.intentId}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
          >
            <span className="inline-flex items-center gap-2 text-sm">
              {payment.rail === null ? (
                // A fiat-only intent has no chain to name, and naming one it did
                // not settle on would be worse than saying nothing.
                <span>Off-chain</span>
              ) : (
                <>
                  <RailMark asset={payment.rail.asset} chain={payment.rail.chain} size={28} />
                  <span>{payment.rail.asset}</span>
                  <span className="text-muted">on {chainLabel(payment.rail.chain)}</span>
                </>
              )}
            </span>
            <span className="inline-flex items-baseline gap-3 text-sm tabular-nums">
              <strong className="font-medium">{payment.amount.display}</strong>
              <span className="text-muted">{paidOn(payment.paidAt)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

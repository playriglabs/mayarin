import { chainLabel } from "@mayarin/chain";
import clsx from "clsx";
import { useState } from "react";
import type { MessageKey } from "../../i18n/en.ts";
import { LanguageSwitcher, useI18n } from "../../i18n/index.tsx";
import { Brand } from "../../shared/brand.tsx";
import { BuyerProtection, railBody } from "../../shared/buyer-protection.tsx";
import { CheckoutShell, TestnetBanner } from "../../shared/checkout-shell.tsx";
import { CheckoutSummary, type SummaryRow } from "../../shared/checkout-summary.tsx";
import { EstimateRow } from "../../shared/estimate-row.tsx";
import { withPayerToken } from "../../shared/payer-token.ts";
import { PoweredBy } from "../../shared/powered-by.tsx";
import { RailMark } from "../../shared/rail-mark.tsx";
import { RAIL_SLOT, RailPicker, RailSentence, railSummary } from "../../shared/rail-picker.tsx";
import {
  offersReturnAddress,
  ReturnAddressField,
  validReturnAddress,
} from "../../shared/return-address.tsx";
import { errorText, noteText, panelIntro, panelTitle, primaryButton } from "../../shared/ui.ts";
import { canContinueWithQuote, useQuoteEstimate } from "../link/use-quote-estimate.ts";
import { dateLine, paidOn, STATUS_TONE, shortDate, statusLabel } from "./invoice-status.ts";
import { PaidMark } from "./paid-mark.tsx";
import type { InvoiceBootstrap, InvoicePaymentRecord, SubscriptionInterval } from "./types.ts";

const INTERVAL_SUFFIX = {
  week: "perWeek",
  month: "perMonth",
  year: "perYear",
} as const satisfies Record<SubscriptionInterval, MessageKey>;

const INTERVAL_ROW = {
  week: "weekly",
  month: "monthly",
  year: "yearly",
} as const satisfies Record<SubscriptionInterval, MessageKey>;

/**
 * One page that serves two readers. While something is owed, a buyer sees the
 * same checkout every payment uses — a subscription's cycle priced as a plan —
 * and a button that mints a Payment Intent for it. Once paid or void, the same
 * URL is the document a finance team files, on screen and on paper. The printable view is the
 * same markup with `print:` classes, never a second route, so the printed page
 * cannot drift from the one the buyer looked at.
 */
export function InvoicePage({ bootstrap }: { readonly bootstrap: InvoiceBootstrap }) {
  const { locale, t } = useI18n();
  const { status, buyer, lines, payable, payments } = bootstrap;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rail, setRail] = useState(bootstrap.rails[0]);
  const [payerAddress, setPayerAddress] = useState<string | null>(null);
  const [returnAddress, setReturnAddress] = useState("");

  // The outstanding balance in the asset the payer picked, from the same rate
  // source the lock reads — so "Pay Rp 49.000" also says how much PYUSD that is.
  const quote = useQuoteEstimate(
    bootstrap.outstanding.formatted,
    bootstrap.outstanding.asset,
    payable ? rail : undefined,
  );
  const { estimate } = quote;
  const quoteReady = canContinueWithQuote(estimate);
  const returnAddressInvalid =
    returnAddress.trim() !== "" && validReturnAddress(returnAddress) === null;

  async function pay() {
    if (rail === undefined || !quoteReady || busy || returnAddressInvalid) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(bootstrap.checkoutUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payment: railBody(
            rail,
            bootstrap.protection,
            payerAddress,
            validReturnAddress(returnAddress),
          ),
          executionPath: "deposit-match",
        }),
      });
      const created = await response.json();
      if (!response.ok) {
        setError(created?.error?.message ?? t("unableToStartPayment"));
        setBusy(false);
        return;
      }
      const confirmation = await fetch(
        withPayerToken(
          `/v1/payment-intents/${created.paymentIntent.id}/confirm`,
          created.payerToken,
        ),
        { method: "POST" },
      );
      const confirmed = await confirmation.json();
      if (!confirmation.ok || confirmed?.paymentIntent?.status === "FAILED") {
        setError(
          confirmed?.error?.message ??
            confirmed?.paymentIntent?.failureReason ??
            t("priceCouldNotBeLocked"),
        );
        setBusy(false);
        return;
      }
      location.href = `/checkout/pay/${created.paymentIntent.id}?t=${encodeURIComponent(created.payerToken)}`;
    } catch {
      setError(t("networkError"));
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
          <h1 className="m-0 text-2xl font-normal">
            {t("invoiceNumber", { number: bootstrap.number ?? t("draftNumber") })}
          </h1>
          <p className="mt-1 mb-0 text-xs text-muted">
            {dateLine(bootstrap.issuedAt, bootstrap.dueAt, t, locale)}
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
            {statusLabel(status, t)}
          </p>
        </div>
      </header>

      <div className="my-6 flex flex-wrap gap-8">
        <dl className="m-0 min-w-48">
          <dt className="mb-1 text-[11px] tracking-wide text-muted uppercase">{t("from")}</dt>
          <dd className="m-0">{bootstrap.merchant.name}</dd>
          <dd className="m-0 text-muted">{bootstrap.merchant.city}</dd>
        </dl>
        <dl className="m-0 min-w-48">
          <dt className="mb-1 text-[11px] tracking-wide text-muted uppercase">{t("billTo")}</dt>
          <dd className="m-0">{buyer.name}</dd>
          {buyer.address !== null && <dd className="m-0 text-muted">{buyer.address}</dd>}
          {buyer.taxId !== null && (
            <dd className="m-0 text-muted">{t("taxIdValue", { value: buyer.taxId })}</dd>
          )}
          {buyer.email !== null && <dd className="m-0 text-muted">{buyer.email}</dd>}
        </dl>
      </div>

      <table className="mt-2 w-full border-collapse">
        <thead>
          <tr>
            <th className={head}>{t("description")}</th>
            <th className={`${head} ${num}`}>{t("quantity")}</th>
            <th className={`${head} ${num}`}>{t("unitPrice")}</th>
            <th className={`${head} ${num}`}>{t("total")}</th>
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
              {t("total")}
            </td>
            <td className={`pt-3 text-[15px] ${num}`}>{bootstrap.total.display}</td>
          </tr>
          <tr>
            <td colSpan={3} className="pt-1.5 text-muted">
              {t("amountPaid")}
            </td>
            <td className={`pt-1.5 text-muted ${num}`}>{bootstrap.paid.display}</td>
          </tr>
          <tr>
            <td colSpan={3} className="pt-1.5">
              {t("amountDue")}
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
          aria-label={t("invoiceLabel")}
          className="flex flex-1 flex-col items-center justify-center bg-page px-5 py-12 print:block print:bg-white print:p-0"
        >
          <div className="w-full max-w-3xl print:max-w-none">{invoiceDocument}</div>
          <div className="mt-10 flex items-center justify-center gap-4 print:hidden">
            <PoweredBy />
            <LanguageSwitcher />
          </div>
        </main>
      </div>
    );
  }

  // Something is owed: the same checkout every payment uses — the order on the
  // left, the payment on the right. A subscription's cycle reads as a plan,
  // "Rp 99.000 / mo", rather than as a document with one line on it.
  const interval = bootstrap.subscription?.interval;
  const plan = interval !== undefined && lines.length === 1;
  const breakdown: SummaryRow[] = [{ label: t("subtotal"), value: bootstrap.total.display }];
  if (bootstrap.paid.amount !== "0") {
    breakdown.push({ label: t("amountPaid"), value: bootstrap.paid.display });
  }
  breakdown.push({
    label: interval === undefined ? t("amountDue") : t(INTERVAL_ROW[interval]),
    value: bootstrap.outstanding.display,
  });
  const details: SummaryRow[] = [
    { label: t("invoiceLabel"), value: bootstrap.number ?? t("draftNumber") },
    { label: t("billedTo"), value: buyer.name },
  ];
  if (buyer.taxId !== null) details.push({ label: t("taxId"), value: buyer.taxId });
  // An absent date is said in words, never as a dash.
  if (bootstrap.dueAt !== null) {
    details.push({ label: t("due"), value: shortDate(bootstrap.dueAt, locale) });
  } else if (bootstrap.issuedAt === null) {
    details.push({ label: t("issued"), value: t("notYetIssued") });
  }

  return (
    <CheckoutShell
      label={t("payThisInvoice")}
      summary={
        <CheckoutSummary
          label={t("invoiceLabel")}
          // The merchant's name alone: an invoice's dates already fill the line
          // under the price, and the city adds nothing a payer needs here.
          merchant={{ ...bootstrap.merchant, city: "" }}
          title={
            plan
              ? (lines[0]?.name ?? t("subscription"))
              : t("invoiceNumber", { number: bootstrap.number ?? t("draftNumber") })
          }
          totalDisplay={bootstrap.outstanding.display}
          {...(interval === undefined ? {} : { priceSuffix: t(INTERVAL_SUFFIX[interval]) })}
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
      <h2 className={panelTitle}>{t("payThisInvoice")}</h2>
      <p className={panelIntro}>
        {bootstrap.rails.length === 1
          ? t("payableWith", { rail: railSummary(rail, t) })
          : t("chooseHeldAsset")}
      </p>

      <RailPicker rails={bootstrap.rails} selected={rail} onSelect={setRail} />

      {rail !== undefined && <EstimateRow asset={rail.asset} quote={quote} />}

      <BuyerProtection
        protection={bootstrap.protection}
        rail={rail}
        payerAddress={payerAddress}
        onPayerAddress={setPayerAddress}
      />
      {rail !== undefined && offersReturnAddress(rail.chain) && (
        <ReturnAddressField value={returnAddress} onChange={setReturnAddress} />
      )}

      <button
        type="button"
        className={`${primaryButton} mt-6`}
        disabled={busy || rail === undefined || !quoteReady || returnAddressInvalid}
        onClick={() => void pay()}
      >
        {busy
          ? t("preparingPayment")
          : estimate.status === "unavailable"
            ? t("paymentUnavailable")
            : t("payAmount", { amount: bootstrap.outstanding.display })}
      </button>
      {error !== "" && (
        <p className={errorText} role="alert">
          {error}
        </p>
      )}
      <p className={`${noteText} text-center`}>
        <RailSentence text={t("exactAmountLocked", { rail: RAIL_SLOT })} rail={rail} />
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
  const { locale, t } = useI18n();
  return (
    <section className="mt-6 rounded-2xl border border-line p-4">
      <h2 className="m-0 inline-flex items-center gap-1.5 text-xs text-brand">
        <PaidMark size={13} />
        {t("paidWith")}
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
                <span>{t("offChain")}</span>
              ) : (
                <>
                  <RailMark asset={payment.rail.asset} chain={payment.rail.chain} size={28} />
                  <span>{payment.rail.asset}</span>
                  <span className="text-muted">
                    {t("onChain", { chain: chainLabel(payment.rail.chain) })}
                  </span>
                </>
              )}
            </span>
            <span className="inline-flex items-baseline gap-3 text-sm tabular-nums">
              <strong className="font-medium">{payment.amount.display}</strong>
              <span className="text-muted">{paidOn(payment.paidAt, locale)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

import { useState } from "react";
import { CheckoutSummary } from "../../shared/checkout-summary.tsx";
import { currencySymbol } from "../../shared/currency.ts";
import { RailPicker, railSummary } from "../../shared/rail-picker.tsx";
import { checkoutBody } from "./checkout-body.ts";
import type { LinkBootstrap } from "./types.ts";
import { useQuoteEstimate } from "./use-quote-estimate.ts";

/**
 * The link page: what is being bought, on which rail, and one button.
 *
 * Three things it deliberately does *not* do, carried over from the
 * server-rendered page it replaces:
 *
 * - **No QR.** A QR of this page's own URL belongs to the counter — the
 *   dashboard's "Take payment" — not to the buyer who already has the page open.
 * - **No intent until the button.** Minting on load would expire a price lock
 *   while the buyer typed, and burn a deposit address per curious click.
 * - **No price it cannot honour.** The estimate reads `POST /v1/quotes` — the
 *   same rate provider the lock will read — and is labelled an estimate.
 *
 * The rail is the payer's choice now (#244), network and asset both. It used to
 * be one asset list unioned across every configured chain, on a chain the
 * deployment picked — so a payer on Arc was offered ETH, which does not exist
 * there. A deployment with one rail renders exactly what it rendered before:
 * `RailPicker` asks nothing when there is nothing to ask.
 */
export function LinkPage({ bootstrap }: { readonly bootstrap: LinkBootstrap }) {
  const { payable, currency, total, lines, rails, settlementAsset, lockMinutes } = bootstrap;
  const [rail, setRail] = useState(rails[0]);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const typedAmount = total === null ? amount : total.formatted;
  const displayCurrency = currencySymbol(currency);
  const estimate = useQuoteEstimate(typedAmount, currency, rail, settlementAsset);
  // A merchant with no rail cannot be paid at all — say so, rather than
  // offering a button whose only outcome is a refusal.
  const payableNow = payable && rail !== undefined;

  async function pay() {
    if (total === null && Number(amount) <= 0) {
      setError("Enter an amount first.");
      return;
    }
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`/v1/payment-links/${bootstrap.linkId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checkoutBody(bootstrap, amount, rail)),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error?.message ?? "Unable to create the payment");
        setBusy(false);
        return;
      }

      // Minting an intent does not lock a price or allocate a deposit address —
      // confirming it is what hands it to the clearing engine. The payment page
      // has nothing to show until this has run, so it runs before the redirect.
      const intentId: string = payload.paymentIntent.id;
      const confirmation = await fetch(`/v1/payment-intents/${intentId}/confirm`, {
        method: "POST",
      });
      const confirmed = await confirmation.json();
      if (!confirmation.ok) {
        setError(confirmed?.error?.message ?? "Unable to lock the price");
        setBusy(false);
        return;
      }
      if (confirmed.paymentIntent.status === "FAILED") {
        setError(confirmed.paymentIntent.failureReason ?? "The price could not be locked");
        setBusy(false);
        return;
      }

      location.href = `/checkout/pay/${intentId}`;
    } catch {
      setError("Network error. Please try again.");
      setBusy(false);
    }
  }

  return (
    <main className="checkout-shell">
      <CheckoutSummary
        merchant={bootstrap.merchant}
        title={bootstrap.title}
        totalDisplay={total?.display ?? `${displayCurrency} ${amount || "0"}`}
        lines={lines}
      />
      <section className="checkout-panel" aria-label="Payment details">
        <div className="payment-form">
          <p className="section-kicker">Secure checkout</p>
          <h2>Choose how to pay</h2>
          <p className="panel-intro">
            {rail === undefined
              ? `Pay ${bootstrap.merchant.name}.`
              : rails.length === 1
                ? `Pay ${bootstrap.merchant.name} with ${railSummary(rail)}.`
                : `Select an asset and network to pay ${bootstrap.merchant.name}.`}
          </p>

          {total === null && (
            <div className="form-block">
              <label className="label" htmlFor="amount">
                Amount
              </label>
              <div className="field">
                <span>{displayCurrency}</span>
                <input
                  id="amount"
                  inputMode="decimal"
                  placeholder="0"
                  autoComplete="off"
                  // biome-ignore lint/a11y/noAutofocus: typing the amount is the page's only task
                  autoFocus
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </div>
            </div>
          )}

          {payableNow ? (
            <>
              <RailPicker rails={rails} selected={rail} onSelect={setRail} />

              <div className="payment-estimate" aria-live="polite">
                <span>Estimated total in {rail.asset}</span>
                <strong>{estimate}</strong>
              </div>

              <p className="checkout-note">
                The exact price is locked for {lockMinutes} minutes on the next step. Only send{" "}
                <strong>{railSummary(rail)}</strong> to the address shown there.
              </p>
              <button type="button" className="primary" disabled={busy} onClick={() => void pay()}>
                {busy ? "Preparing payment…" : `Continue with ${rail.asset}`}
              </button>
              {error !== "" && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </>
          ) : (
            <div className="unavailable">
              <h3>
                {payable
                  ? "This merchant has no payment method available"
                  : "This payment link is no longer available"}
              </h3>
              <p>Contact the merchant for a new payment link.</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

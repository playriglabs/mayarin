import { useEffect, useRef, useState } from "react";
import { AssetLogo } from "./AssetLogo.tsx";
import { CheckoutSummary } from "./CheckoutSummary.tsx";
import { checkoutBody } from "./checkout-body.ts";
import { currencySymbol } from "./currency-symbol.ts";
import type { LinkBootstrap } from "./types.ts";

/**
 * The link page: what is being bought, in what asset, and one button.
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
 */
export function LinkPage({ bootstrap }: { readonly bootstrap: LinkBootstrap }) {
  const { payable, currency, total, lines, accepted, lockMinutes } = bootstrap;
  const [asset, setAsset] = useState<string | undefined>(accepted[0]);
  const [amount, setAmount] = useState("");
  const [estimate, setEstimate] = useState("Calculating…");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const typedAmount = total === null ? amount : total.formatted;
  const displayCurrency = currencySymbol(currency);

  // Debounced rather than fired per keystroke: the quote reads a live rate
  // source, and a request per character is a request per character.
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (currency === null || asset === undefined || Number(typedAmount) <= 0) {
      setEstimate("Enter an amount");
      return;
    }
    clearTimeout(debounce.current);
    setEstimate("Calculating…");
    debounce.current = setTimeout(async () => {
      try {
        const response = await fetch("/v1/quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: { amount: typedAmount, asset: currency },
            assets: [asset],
          }),
        });
        const payload = await response.json();
        const line = payload?.quotes?.[0];
        setEstimate(line?.available ? line.amount.display : "Unavailable");
      } catch {
        setEstimate("Unavailable");
      }
    }, 400);
    return () => clearTimeout(debounce.current);
  }, [typedAmount, currency, asset]);

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
        body: JSON.stringify(checkoutBody(bootstrap, amount, asset)),
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
            Pay {bootstrap.merchant.name} on the {bootstrap.chain} network.
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

          {payable ? (
            <>
              <div className="form-block">
                <span className="label">Pay with</span>
                <div className="assets">
                  {accepted.map((choice) => (
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

              <div className="payment-estimate" aria-live="polite">
                <span>Estimated total in {asset ?? "selected asset"}</span>
                <strong>{estimate}</strong>
              </div>

              <ol className="payment-steps">
                <li>Choose the asset you want to send.</li>
                <li>Continue to lock the price for {lockMinutes} minutes.</li>
                <li>Scan the QR code or copy the address, then wait for confirmation.</li>
              </ol>

              <p className="estimate-note">
                Estimated, final price may change. Prices are locked for {lockMinutes} minutes once
                you press the button below.
              </p>
              <button type="button" className="primary" disabled={busy} onClick={() => void pay()}>
                {busy ? "Preparing payment…" : `Continue with ${asset ?? "asset"}`}
              </button>
              {error !== "" && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </>
          ) : (
            <div className="unavailable">
              <h3>This payment link is no longer available</h3>
              <p>Contact the merchant for a new payment link.</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

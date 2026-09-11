import { useState } from "react";
import { RailPicker, railSummary } from "../../shared/rail-picker.tsx";
import { canContinueWithQuote, useQuoteEstimate } from "../link/use-quote-estimate.ts";
import type { PayBootstrap, RailChoice } from "./types.ts";

/**
 * How the payer will pay, asked before anything is locked.
 *
 * For an intent minted without a rail — a storefront's cart checkout. The same
 * panel a payment link shows: the rail picker, an estimate from the rate source
 * the lock will read, and one button. The button confirms the intent on the
 * chosen rail, and the page is then reloaded from that intent, so what follows
 * is the ordinary payment page for the rail just picked.
 */
export function ChooseRail({
  bootstrap,
  choice,
}: {
  readonly bootstrap: PayBootstrap;
  readonly choice: RailChoice;
}) {
  const { rails, settlementAsset, lockMinutes } = choice;
  const [rail, setRail] = useState(rails[0]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const estimate = useQuoteEstimate(
    bootstrap.amount.formatted,
    bootstrap.amount.asset,
    rail,
    settlementAsset,
  );
  const quoteReady = canContinueWithQuote(estimate);

  async function pay() {
    if (rail === undefined || !quoteReady || busy) return;
    setBusy(true);
    setError("");

    try {
      // The hosted page has no wallet to connect, so it pins the deposit path —
      // the same choice the link page makes.
      const response = await fetch(`/v1/payment-intents/${bootstrap.intentId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment: { asset: rail.asset, chain: rail.chain },
          executionPath: "deposit-match",
        }),
      });
      const confirmed = await response.json();
      if (!response.ok) {
        setError(confirmed?.error?.message ?? "Unable to lock the price");
        setBusy(false);
        return;
      }
      if (confirmed.paymentIntent.status === "FAILED") {
        setError(confirmed.paymentIntent.failureReason ?? "The price could not be locked");
        setBusy(false);
        return;
      }

      location.reload();
    } catch {
      setError("Network error. Please try again.");
      setBusy(false);
    }
  }

  return (
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

      {rail === undefined ? (
        <div className="unavailable">
          <h3>This merchant has no payment method available</h3>
          <p>Contact the merchant to complete this order.</p>
        </div>
      ) : (
        <>
          <RailPicker rails={rails} selected={rail} onSelect={setRail} />

          <div
            className="payment-estimate"
            aria-busy={estimate.status === "loading"}
            aria-live="polite"
          >
            <span>Estimated total in {rail.asset}</span>
            <strong>{estimate.display}</strong>
          </div>

          {estimate.status === "unavailable" && (
            <p className="quote-error" role="alert">
              {estimate.message}
            </p>
          )}

          <p className="checkout-note">
            The exact price is locked for {lockMinutes} minutes on the next step. Only send{" "}
            <strong>{railSummary(rail)}</strong> to the address shown there.
          </p>
          <button
            type="button"
            className="primary"
            disabled={busy || !quoteReady}
            onClick={() => void pay()}
          >
            {busy
              ? "Preparing payment…"
              : estimate.status === "unavailable"
                ? "Payment unavailable"
                : estimate.status === "loading"
                  ? "Calculating price…"
                  : `Continue with ${rail.asset}`}
          </button>
          {error !== "" && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}

import { useState } from "react";
import { BuyerProtection, protectionApplies, railBody } from "../../shared/buyer-protection.tsx";
import { rememberLocalCurrencyIntent } from "../../shared/local-currency-intent.ts";
import {
  LocalCurrencyPanel,
  type PaymentMethod,
  PaymentMethodTabs,
  useLocalCurrencyRail,
} from "../../shared/local-currency-option.tsx";
import { withPayerToken } from "../../shared/payer-token.ts";
import { RailPicker, railSummary } from "../../shared/rail-picker.tsx";
import type { Rail } from "../../shared/types.ts";
import {
  errorText,
  estimateRow,
  noteText,
  panelIntro,
  panelTitle,
  primaryButton,
  unavailableBox,
} from "../../shared/ui.ts";
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
  const { rails, lockMinutes } = choice;
  const [rail, setRail] = useState(rails[0]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // An escrowed payment names the payer's wallet in its terms (#304): that
  // wallet releases or disputes later, and receives a refund.
  const [payerAddress, setPayerAddress] = useState<string | null>(null);
  const { protection } = bootstrap;
  const needsWallet =
    protection?.required === true && protectionApplies(protection, rail) && payerAddress === null;

  const estimate = useQuoteEstimate(bootstrap.amount.formatted, bootstrap.amount.asset, rail);
  const quoteReady = canContinueWithQuote(estimate);

  const localRail = useLocalCurrencyRail(rails, protection, { paymentId: bootstrap.intentId });
  const [method, setMethod] = useState<PaymentMethod>("crypto");

  async function confirm(target: Rail, localCurrency: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");

    try {
      // The hosted page has no wallet to connect, so it pins the deposit path —
      // the same choice the link page makes.
      const response = await fetch(
        withPayerToken(`/v1/payment-intents/${bootstrap.intentId}/confirm`, bootstrap.payerToken),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payment: railBody(target, protection, localCurrency ? null : payerAddress),
            executionPath: "deposit-match",
          }),
        },
      );
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

      if (localCurrency) rememberLocalCurrencyIntent(bootstrap.intentId);
      location.reload();
    } catch {
      setError("Network error. Please try again.");
      setBusy(false);
    }
  }

  function pay() {
    if (rail === undefined || !quoteReady || needsWallet) return;
    void confirm(rail, false);
  }

  return (
    <>
      <h2 className={panelTitle}>Choose how to pay</h2>
      <p className={panelIntro}>
        {rail === undefined
          ? `Pay ${bootstrap.merchant.name}.`
          : rails.length === 1
            ? `Pay ${bootstrap.merchant.name} with ${railSummary(rail)}.`
            : `Select an asset and network to pay ${bootstrap.merchant.name}.`}
      </p>

      {rail === undefined ? (
        <div className={unavailableBox}>
          <h3>This merchant has no payment method available</h3>
          <p>Contact the merchant to complete this order.</p>
        </div>
      ) : (
        <>
          {localRail !== undefined && (
            <PaymentMethodTabs value={method} onChange={setMethod} disabled={busy} />
          )}
          {method === "local" && localRail !== undefined ? (
            <LocalCurrencyPanel
              busy={busy}
              error={error}
              lockMinutes={lockMinutes}
              rail={localRail}
              onContinue={() => void confirm(localRail, true)}
            />
          ) : (
            <>
              <RailPicker rails={rails} selected={rail} onSelect={setRail} />

              <div
                className={estimateRow}
                aria-busy={estimate.status === "loading"}
                aria-live="polite"
              >
                <span>Estimated total in {rail.asset}</span>
                <strong>{estimate.display}</strong>
              </div>

              {estimate.status === "unavailable" && (
                <p className={errorText} role="alert">
                  {estimate.message}
                </p>
              )}

              <BuyerProtection
                protection={protection}
                rail={rail}
                payerAddress={payerAddress}
                onPayerAddress={setPayerAddress}
              />
              <button
                type="button"
                className={`${primaryButton} mt-6`}
                disabled={busy || !quoteReady || needsWallet}
                onClick={pay}
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
                <p className={errorText} role="alert">
                  {error}
                </p>
              )}
              <p className={`${noteText} text-center`}>
                The exact price is locked for {lockMinutes} minutes on the next step. Only send{" "}
                <strong className="font-medium text-ink">{railSummary(rail)}</strong> to the address
                shown there.
              </p>
            </>
          )}
        </>
      )}
    </>
  );
}

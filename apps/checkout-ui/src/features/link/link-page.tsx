import { useState } from "react";
import { useT } from "../../i18n/index.tsx";
import { BuyerProtection } from "../../shared/buyer-protection.tsx";
import { CheckoutShell } from "../../shared/checkout-shell.tsx";
import { CheckoutSummary } from "../../shared/checkout-summary.tsx";
import { currencySymbol, groupAmount, ungroupAmount } from "../../shared/currency.ts";
import { EstimateRow } from "../../shared/estimate-row.tsx";
import { rememberLocalCurrencyIntent } from "../../shared/local-currency-intent.ts";
import {
  LocalCurrencyPanel,
  type PaymentMethod,
  PaymentMethodTabs,
  useLocalCurrencyRail,
} from "../../shared/local-currency-option.tsx";
import { withPayerToken } from "../../shared/payer-token.ts";
import { RAIL_SLOT, RailPicker, RailSentence, railSummary } from "../../shared/rail-picker.tsx";
import {
  offersReturnAddress,
  ReturnAddressField,
  validReturnAddress,
} from "../../shared/return-address.tsx";
import type { Rail } from "../../shared/types.ts";
import {
  errorText,
  fieldLabel,
  noteText,
  panelIntro,
  panelTitle,
  primaryButton,
  unavailableBox,
} from "../../shared/ui.ts";
import { checkoutBody } from "./checkout-body.ts";
import type { LinkBootstrap } from "./types.ts";
import { canContinueWithQuote, useQuoteEstimate } from "./use-quote-estimate.ts";

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
  const t = useT();
  const { payable, currency, total, lines, rails, unpayableReason, lockMinutes } = bootstrap;
  const [rail, setRail] = useState(rails[0]);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [payerAddress, setPayerAddress] = useState<string | null>(null);
  const [returnAddress, setReturnAddress] = useState("");

  const typedAmount = total === null ? amount : total.formatted;
  const displayCurrency = currencySymbol(currency);
  const quote = useQuoteEstimate(typedAmount, currency, rail);
  const { estimate } = quote;
  // A merchant with no rail cannot be paid at all — say so, rather than
  // offering a button whose only outcome is a refusal.
  const payableNow = payable && rail !== undefined;
  const quoteReady = canContinueWithQuote(estimate);
  const returnAddressInvalid =
    returnAddress.trim() !== "" && validReturnAddress(returnAddress) === null;
  const localRail = useLocalCurrencyRail(rails, bootstrap.protection, {
    linkId: bootstrap.linkId,
  });
  const [method, setMethod] = useState<PaymentMethod>("crypto");

  /** Mints and confirms the intent on `target`, then opens its payment page. */
  async function start(target: Rail, localCurrency: boolean) {
    if (!payable || busy) return;
    if (total === null && Number(amount) <= 0) {
      setError(t("enterAmountFirst"));
      return;
    }
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`/v1/payment-links/${bootstrap.linkId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          checkoutBody(
            bootstrap,
            amount,
            target,
            localCurrency ? null : payerAddress,
            localCurrency ? null : validReturnAddress(returnAddress),
          ),
        ),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error?.message ?? t("unableToCreatePayment"));
        setBusy(false);
        return;
      }

      // Minting an intent does not lock a price or allocate a deposit address —
      // confirming it is what hands it to the clearing engine. The payment page
      // has nothing to show until this has run, so it runs before the redirect.
      const intentId: string = payload.paymentIntent.id;
      const payerToken: string = payload.payerToken;
      const confirmation = await fetch(
        withPayerToken(`/v1/payment-intents/${intentId}/confirm`, payerToken),
        { method: "POST" },
      );
      const confirmed = await confirmation.json();
      if (!confirmation.ok) {
        setError(confirmed?.error?.message ?? t("unableToLockPrice"));
        setBusy(false);
        return;
      }
      if (confirmed.paymentIntent.status === "FAILED") {
        setError(confirmed.paymentIntent.failureReason ?? t("priceCouldNotBeLocked"));
        setBusy(false);
        return;
      }

      if (localCurrency) rememberLocalCurrencyIntent(intentId);
      location.href = `/checkout/pay/${intentId}?t=${encodeURIComponent(payerToken)}`;
    } catch {
      setError(t("networkError"));
      setBusy(false);
    }
  }

  function pay() {
    if (rail === undefined || !quoteReady || returnAddressInvalid) return;
    void start(rail, false);
  }

  return (
    <CheckoutShell
      label={t("paymentDetails")}
      summary={
        <CheckoutSummary
          merchant={bootstrap.merchant}
          title={bootstrap.title}
          totalDisplay={total?.display ?? `${displayCurrency} ${groupAmount(amount) || "0"}`}
          lines={lines}
        />
      }
    >
      <h2 className={panelTitle}>{t("chooseHowToPay")}</h2>
      <p className={panelIntro}>
        {rail === undefined
          ? t("payMerchant", { merchant: bootstrap.merchant.name })
          : rails.length === 1
            ? t("payMerchantWith", {
                merchant: bootstrap.merchant.name,
                rail: railSummary(rail, t),
              })
            : t("selectAssetAndNetwork", { merchant: bootstrap.merchant.name })}
      </p>

      {total === null && (
        <div className="mt-6">
          <label className={fieldLabel} htmlFor="amount">
            {t("amount")}
          </label>
          {/* The symbol matches the figure beside it, so "€ 5" reads as one amount. */}
          <div className="flex min-h-14 items-stretch rounded-xl border border-transparent bg-field focus-within:border-muted">
            <span className="flex items-center pl-4 text-xl text-muted">{displayCurrency}</span>
            <input
              id="amount"
              className="min-w-0 flex-1 border-0 bg-transparent px-3 text-xl text-ink tabular-nums outline-0"
              inputMode="decimal"
              placeholder="0"
              autoComplete="off"
              // biome-ignore lint/a11y/noAutofocus: typing the amount is the page's only task
              autoFocus
              value={groupAmount(amount)}
              onChange={(event) => setAmount(ungroupAmount(event.target.value, currency))}
            />
          </div>
        </div>
      )}

      {payableNow ? (
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
              onContinue={() => void start(localRail, true)}
            />
          ) : (
            <>
              <RailPicker rails={rails} selected={rail} onSelect={setRail} />

              <EstimateRow asset={rail.asset} quote={quote} />

              <BuyerProtection
                protection={bootstrap.protection}
                rail={rail}
                payerAddress={payerAddress}
                onPayerAddress={setPayerAddress}
              />
              {offersReturnAddress(rail.chain) && (
                <ReturnAddressField value={returnAddress} onChange={setReturnAddress} />
              )}

              <button
                type="button"
                className={`${primaryButton} mt-6`}
                disabled={busy || !quoteReady || returnAddressInvalid}
                onClick={pay}
              >
                {busy
                  ? t("preparingPayment")
                  : estimate.status === "unavailable"
                    ? t("paymentUnavailable")
                    : estimate.status === "idle"
                      ? t("enterAmountToContinue")
                      : estimate.status === "loading"
                        ? t("calculatingPrice")
                        : t("continueWith", { asset: rail.asset })}
              </button>
              {error !== "" && (
                <p className={errorText} role="alert">
                  {error}
                </p>
              )}
              <p className={`${noteText} text-center`}>
                <RailSentence
                  text={t("priceLockNote", { minutes: lockMinutes, rail: RAIL_SLOT })}
                  rail={rail}
                />
              </p>
            </>
          )}
        </>
      ) : (
        <div className={unavailableBox}>
          <h3>{payable ? t("noPaymentMethod") : t("linkUnavailable")}</h3>
          <p>{unpayableReason ?? t("contactMerchantForLink")}</p>
        </div>
      )}
    </CheckoutShell>
  );
}

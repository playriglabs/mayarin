import { useState } from "react";
import { useT } from "../../i18n/index.tsx";
import { BuyerProtection, protectionApplies, railBody } from "../../shared/buyer-protection.tsx";
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
  const t = useT();
  const { rails, lockMinutes } = choice;
  const [rail, setRail] = useState(rails[0]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // An escrowed payment names the payer's wallet in its terms (#304): that
  // wallet releases or disputes later, and receives a refund.
  const [payerAddress, setPayerAddress] = useState<string | null>(null);
  const [returnAddress, setReturnAddress] = useState("");
  const { protection } = bootstrap;
  const needsWallet =
    protection?.required === true && protectionApplies(protection, rail) && payerAddress === null;

  const quote = useQuoteEstimate(bootstrap.amount.formatted, bootstrap.amount.asset, rail);
  const { estimate } = quote;
  const quoteReady = canContinueWithQuote(estimate);
  const returnAddressInvalid =
    returnAddress.trim() !== "" && validReturnAddress(returnAddress) === null;

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
            payment: railBody(
              target,
              protection,
              localCurrency ? null : payerAddress,
              localCurrency ? null : validReturnAddress(returnAddress),
            ),
            executionPath: "deposit-match",
          }),
        },
      );
      const confirmed = await response.json();
      if (!response.ok) {
        setError(confirmed?.error?.message ?? t("unableToLockPrice"));
        setBusy(false);
        return;
      }
      if (confirmed.paymentIntent.status === "FAILED") {
        setError(confirmed.paymentIntent.failureReason ?? t("priceCouldNotBeLocked"));
        setBusy(false);
        return;
      }

      if (localCurrency) rememberLocalCurrencyIntent(bootstrap.intentId);
      location.reload();
    } catch {
      setError(t("networkError"));
      setBusy(false);
    }
  }

  function pay() {
    if (rail === undefined || !quoteReady || needsWallet || returnAddressInvalid) return;
    void confirm(rail, false);
  }

  return (
    <>
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

      {rail === undefined ? (
        <div className={unavailableBox}>
          <h3>{t("noPaymentMethod")}</h3>
          <p>{t("contactMerchantToComplete")}</p>
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

              <EstimateRow asset={rail.asset} quote={quote} />

              <BuyerProtection
                protection={protection}
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
                disabled={busy || !quoteReady || needsWallet || returnAddressInvalid}
                onClick={pay}
              >
                {busy
                  ? t("preparingPayment")
                  : estimate.status === "unavailable"
                    ? t("paymentUnavailable")
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
      )}
    </>
  );
}

import { useEffect, useState } from "react";
import type { Rail } from "../../shared/types.ts";

export type QuoteEstimate =
  | { readonly status: "idle"; readonly display: "Enter an amount" }
  | { readonly status: "loading"; readonly display: "Calculating…" }
  | { readonly status: "available"; readonly display: string }
  | { readonly status: "unavailable"; readonly display: "Unavailable"; readonly message: string };

const CALCULATING: QuoteEstimate = { status: "loading", display: "Calculating…" };
const ENTER_AMOUNT: QuoteEstimate = { status: "idle", display: "Enter an amount" };
const QUOTE_UNAVAILABLE =
  "This payment method cannot be priced right now. Choose another option or refresh the page.";
const QUOTE_REQUEST_FAILED =
  "We couldn't calculate this price. Check your connection, then refresh the page.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Turns an untrusted quote response into the only states the checkout can render. */
export function quoteEstimateFrom(payload: unknown): QuoteEstimate {
  if (!isRecord(payload) || !Array.isArray(payload.quotes)) {
    return { status: "unavailable", display: "Unavailable", message: QUOTE_UNAVAILABLE };
  }

  const line: unknown = payload.quotes[0];
  if (!isRecord(line) || line.available !== true) {
    return { status: "unavailable", display: "Unavailable", message: QUOTE_UNAVAILABLE };
  }

  const amount = line.amount;
  const display = isRecord(amount) ? amount.display : undefined;
  return typeof display === "string" && display !== ""
    ? { status: "available", display }
    : { status: "unavailable", display: "Unavailable", message: QUOTE_UNAVAILABLE };
}

export function canContinueWithQuote(estimate: QuoteEstimate): boolean {
  return estimate.status === "available";
}

/**
 * The body `POST /v1/quotes` is asked with.
 *
 * Pure, and exported, because the two fields beside the amount are the whole
 * point of it: a swap leg is priced by a venue whose pool lives on one chain,
 * and whether there is a swap leg at all is decided by what the merchant
 * settles in. Sending neither is what made the link page quote $1 into EURC at
 * the same number on Arc as on Base Sepolia — two different pools, one answer.
 */
export function quoteBody(
  typedAmount: string,
  currency: string,
  rail: Rail,
  settlementAsset: string,
) {
  return {
    amount: { amount: typedAmount, asset: currency },
    assets: [rail.asset],
    chain: rail.chain,
    settlementAsset,
  };
}

/**
 * The "estimated total in <asset>" line.
 *
 * Reads `POST /v1/quotes` — the same rate provider the price lock will read —
 * so the number on screen is one the lock can honour, and is labelled an
 * estimate because only the lock makes it binding. It is quoted on the rail the
 * payer has selected, so switching networks re-prices rather than repeating the
 * first network's answer.
 *
 * Debounced rather than fired per keystroke: the quote reads a live rate
 * source, and a request per character is a request per character.
 */
export function useQuoteEstimate(
  typedAmount: string,
  currency: string | null,
  rail: Rail | undefined,
  settlementAsset: string,
): QuoteEstimate {
  const [estimate, setEstimate] = useState<QuoteEstimate>(CALCULATING);

  useEffect(() => {
    if (currency === null || rail === undefined || Number(typedAmount) <= 0) {
      setEstimate(ENTER_AMOUNT);
      return;
    }

    const controller = new AbortController();
    setEstimate(CALCULATING);
    const debounce = setTimeout(async () => {
      try {
        const response = await fetch("/v1/quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(quoteBody(typedAmount, currency, rail, settlementAsset)),
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        setEstimate(quoteEstimateFrom(payload));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setEstimate({
          status: "unavailable",
          display: "Unavailable",
          message: QUOTE_REQUEST_FAILED,
        });
      }
    }, 400);

    return () => {
      clearTimeout(debounce);
      controller.abort();
    };
  }, [typedAmount, currency, rail, settlementAsset]);

  return estimate;
}

import { useEffect, useRef, useState } from "react";
import type { Rail } from "../../shared/types.ts";

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
): string {
  const [estimate, setEstimate] = useState("Calculating…");
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (currency === null || rail === undefined || Number(typedAmount) <= 0) {
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
          body: JSON.stringify(quoteBody(typedAmount, currency, rail, settlementAsset)),
        });
        const payload = await response.json();
        const line = payload?.quotes?.[0];
        setEstimate(line?.available ? line.amount.display : "Unavailable");
      } catch {
        setEstimate("Unavailable");
      }
    }, 400);
    return () => clearTimeout(debounce.current);
  }, [typedAmount, currency, rail, settlementAsset]);

  return estimate;
}

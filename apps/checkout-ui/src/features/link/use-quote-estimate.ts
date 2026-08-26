import { useEffect, useRef, useState } from "react";

/**
 * The "estimated total in <asset>" line.
 *
 * Reads `POST /v1/quotes` — the same rate provider the price lock will read —
 * so the number on screen is one the lock can honour, and is labelled an
 * estimate because only the lock makes it binding.
 *
 * Debounced rather than fired per keystroke: the quote reads a live rate
 * source, and a request per character is a request per character.
 */
export function useQuoteEstimate(
  typedAmount: string,
  currency: string | null,
  asset: string | undefined,
): string {
  const [estimate, setEstimate] = useState("Calculating…");
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

  return estimate;
}

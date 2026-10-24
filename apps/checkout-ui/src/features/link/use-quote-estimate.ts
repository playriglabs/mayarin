import { useCallback, useEffect, useRef, useState } from "react";
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
export function quoteBody(typedAmount: string, currency: string, rail: Rail) {
  return {
    amount: { amount: typedAmount, asset: currency },
    assets: [rail.asset],
    chain: rail.chain,
    settlementAsset: rail.settlementAsset,
  };
}

/** How often a priced estimate is asked for again while the payer is looking at it. */
export const REFRESH_SECONDS = 15;

/** How long a priced estimate is reused before the same input asks the rate source again. */
const QUOTE_TTL_MS = REFRESH_SECONDS * 1000;

/** Estimates by request body, each good for `ttlMs`. Only a priced estimate is worth keeping. */
export function createQuoteCache(ttlMs: number, now: () => number = Date.now) {
  const held = new Map<string, { readonly estimate: QuoteEstimate; readonly at: number }>();
  return {
    get(key: string): QuoteEstimate | undefined {
      const entry = held.get(key);
      return entry !== undefined && now() - entry.at < ttlMs ? entry.estimate : undefined;
    },
    set(key: string, estimate: QuoteEstimate): void {
      if (estimate.status === "available") held.set(key, { estimate, at: now() });
    },
  };
}

const quoteCache = createQuoteCache(QUOTE_TTL_MS);

/** The estimate, plus what the payer needs to see and do about it going stale. */
export type QuoteView = {
  readonly estimate: QuoteEstimate;
  /** Seconds until the price is asked for again on its own. */
  readonly secondsLeft: number;
  /** A refresh is in flight; the last price stays on screen meanwhile. */
  readonly refreshing: boolean;
  readonly refresh: () => void;
};

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
 * source, and a request per character is a request per character. The same
 * amount, currency and rail inside 15 seconds reuses the last priced estimate
 * instead of asking again, so flipping between rails or retyping a figure does
 * not hit the rate source each time.
 *
 * A price someone stares at goes stale, so a priced estimate is asked for again
 * every 15 seconds, and `refresh` asks now. Both keep the old figure on screen
 * until the new one lands, rather than blanking it to "Calculating…".
 */
export function useQuoteEstimate(
  typedAmount: string,
  currency: string | null,
  rail: Rail | undefined,
): QuoteView {
  const [estimate, setEstimate] = useState<QuoteEstimate>(CALCULATING);
  const [secondsLeft, setSecondsLeft] = useState(REFRESH_SECONDS);
  const [refreshing, setRefreshing] = useState(false);
  const [round, setRound] = useState(0);
  const forced = useRef(false);

  const refresh = useCallback(() => {
    forced.current = true;
    setRound((value) => value + 1);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `round` is the refresh trigger, not a value the effect reads
  useEffect(() => {
    if (currency === null || rail === undefined || Number(typedAmount) <= 0) {
      setEstimate(ENTER_AMOUNT);
      return;
    }

    const manual = forced.current;
    forced.current = false;
    const body = JSON.stringify(quoteBody(typedAmount, currency, rail));
    const cached = manual ? undefined : quoteCache.get(body);
    if (cached !== undefined) {
      setEstimate(cached);
      setSecondsLeft(REFRESH_SECONDS);
      return;
    }

    const controller = new AbortController();
    if (manual) setRefreshing(true);
    else setEstimate(CALCULATING);
    const debounce = setTimeout(
      async () => {
        try {
          const response = await fetch("/v1/quotes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            signal: controller.signal,
          });
          const payload: unknown = await response.json();
          const next = quoteEstimateFrom(payload);
          quoteCache.set(body, next);
          setEstimate(next);
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setEstimate({
            status: "unavailable",
            display: "Unavailable",
            message: QUOTE_REQUEST_FAILED,
          });
        }
        setRefreshing(false);
        setSecondsLeft(REFRESH_SECONDS);
      },
      manual ? 0 : 400,
    );

    return () => {
      clearTimeout(debounce);
      controller.abort();
      setRefreshing(false);
    };
  }, [typedAmount, currency, rail, round]);

  // Count down while a priced estimate is on screen and nothing is in flight.
  const priced = estimate.status === "available";
  useEffect(() => {
    if (!priced || refreshing) return;
    const timer = setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [priced, refreshing]);

  useEffect(() => {
    if (priced && !refreshing && secondsLeft === 0) refresh();
  }, [priced, refreshing, secondsLeft, refresh]);

  return { estimate, secondsLeft, refreshing, refresh };
}

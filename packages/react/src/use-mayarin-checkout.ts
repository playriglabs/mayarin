import { useCallback, useEffect, useRef, useState } from "react";
import { type CheckoutOptions, resolveCheckoutUrl } from "./checkout.ts";

export interface CheckoutCallbacks {
  /**
   * Called with the checkout URL instead of navigating, e.g. to open it in a
   * new tab. Without it the current page goes to the checkout.
   */
  readonly onRedirect?: (url: string) => void;
  readonly onError?: (error: Error) => void;
}

export interface MayarinCheckout {
  /** Mints the checkout and sends the buyer there. A second call while one runs does nothing. */
  readonly redirect: () => Promise<void>;
  readonly loading: boolean;
  readonly error: Error | undefined;
}

/**
 * The headless form of `PayButton`: wire `redirect` to any element you like.
 *
 * Options are read when `redirect` runs, not when the hook first renders, so an
 * amount that changes with the cart is always the current one.
 */
export function useMayarinCheckout(options: CheckoutOptions & CheckoutCallbacks): MayarinCheckout {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const latest = useRef(options);
  latest.current = options;
  const running = useRef(false);

  // Coming back with the browser's back button restores the page from the
  // back/forward cache with the button still busy. Release it.
  useEffect(() => {
    const release = (event: PageTransitionEvent) => {
      if (event.persisted) {
        running.current = false;
        setLoading(false);
      }
    };
    window.addEventListener("pageshow", release);
    return () => window.removeEventListener("pageshow", release);
  }, []);

  const redirect = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setLoading(true);
    setError(undefined);
    const { onRedirect, onError } = latest.current;
    try {
      const url = await resolveCheckoutUrl(latest.current);
      if (onRedirect === undefined) {
        // Stay busy: the page is leaving.
        window.location.assign(url);
        return;
      }
      onRedirect(url);
    } catch (thrown) {
      const failure = thrown instanceof Error ? thrown : new Error(String(thrown));
      setError(failure);
      onError?.(failure);
    }
    running.current = false;
    setLoading(false);
  }, []);

  return { redirect, loading, error };
}

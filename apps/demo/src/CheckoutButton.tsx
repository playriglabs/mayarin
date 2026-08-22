import { useState } from "react";
import { recordPurchase } from "./history.ts";

type CheckoutState =
  | { readonly status: "idle" }
  | { readonly status: "minting" }
  | { readonly status: "error"; readonly message: string };

/**
 * Mints a `catalog` payment link through the thin server, records the
 * purchase locally, and hands the browser to the hosted checkout. The
 * storefront's job ends at the redirect.
 */
export function CheckoutButton({
  lines,
  label,
  purchaseName,
  purchaseQuantity,
  total,
  onRedirect,
}: {
  readonly lines: readonly { readonly productId: string; readonly quantity: number }[];
  readonly label?: string;
  readonly purchaseName: string;
  readonly purchaseQuantity: number;
  readonly total: string;
  /** Runs after the link is minted, just before the browser leaves the page. */
  readonly onRedirect?: () => void;
}) {
  const [state, setState] = useState<CheckoutState>({ status: "idle" });

  async function checkout(): Promise<void> {
    setState({ status: "minting" });
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lines }),
      });
      const body = (await response.json()) as { id?: string; url?: string; error?: string };
      if (!response.ok || body.url === undefined || body.id === undefined) {
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      recordPurchase({
        linkId: body.id,
        name: purchaseName,
        quantity: purchaseQuantity,
        total,
        url: body.url,
        at: new Date().toISOString(),
      });
      onRedirect?.();
      window.location.assign(body.url);
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error
            ? `Checkout could not be prepared. ${error.message}`
            : "Checkout could not be prepared.",
      });
    }
  }

  const minting = state.status === "minting";

  return (
    <div className="checkout">
      <button
        type="button"
        onClick={() => void checkout()}
        disabled={minting}
        aria-busy={minting}
        aria-label={label ?? `Buy ${purchaseName}`}
      >
        {minting ? (
          <>
            <span className="spinner" aria-hidden="true" />
            Preparing…
          </>
        ) : (
          (label ?? "Buy now")
        )}
      </button>
      {state.status === "error" && (
        <p className="notice error" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}

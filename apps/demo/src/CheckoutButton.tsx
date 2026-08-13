import { useState } from "react";

type CheckoutState =
  | { readonly status: "idle" }
  | { readonly status: "minting" }
  | { readonly status: "error"; readonly message: string };

/**
 * Mints a `catalog` payment link through the thin server and hands the browser
 * to the hosted checkout. The demo's job ends at the redirect (#137).
 */
export function CheckoutButton({
  productId,
  productName,
}: {
  readonly productId: string;
  readonly productName: string;
}) {
  const [state, setState] = useState<CheckoutState>({ status: "idle" });

  async function checkout(): Promise<void> {
    setState({ status: "minting" });
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId, quantity: 1 }),
      });
      const body = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || body.url === undefined) {
        throw new Error(body.error ?? `The demo server answered HTTP ${response.status}`);
      }
      window.location.assign(body.url);
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Checkout failed.",
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
        aria-label={`Beli ${productName}`}
      >
        {minting ? (
          <>
            <span className="spinner" aria-hidden="true" />
            Menyiapkan…
          </>
        ) : (
          "Beli"
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

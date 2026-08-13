import { useState } from "react";

type CheckoutState =
  | { readonly status: "idle" }
  | { readonly status: "minting" }
  | { readonly status: "error"; readonly message: string };

/**
 * Mints a `catalog` payment link through the thin server and hands the
 * browser to the hosted checkout. The storefront's job ends at the redirect.
 */
export function CheckoutButton({
  productId,
  productName,
  quantity,
}: {
  readonly productId: string;
  readonly productName: string;
  readonly quantity: number;
}) {
  const [state, setState] = useState<CheckoutState>({ status: "idle" });

  async function checkout(): Promise<void> {
    setState({ status: "minting" });
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId, quantity }),
      });
      const body = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || body.url === undefined) {
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      window.location.assign(body.url);
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error
            ? `Pembayaran tidak bisa disiapkan — ${error.message}`
            : "Pembayaran tidak bisa disiapkan.",
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
          "Beli sekarang"
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

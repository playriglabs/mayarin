import { useEffect, useRef, useState } from "react";
import { Brand } from "./Brand.tsx";
import { checkoutBody } from "./checkout-body.ts";
import type { LinkBootstrap } from "./types.ts";

/**
 * The link page: what is being bought, in what asset, and one button.
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
 */
export function LinkPage({ bootstrap }: { readonly bootstrap: LinkBootstrap }) {
  const { payable, currency, total, lines, accepted, lockMinutes } = bootstrap;
  const [asset, setAsset] = useState<string | undefined>(accepted[0]);
  const [amount, setAmount] = useState("");
  const [estimate, setEstimate] = useState("—");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const typedAmount = total === null ? amount : total.formatted;

  // Debounced rather than fired per keystroke: the quote reads a live rate
  // source, and a request per character is a request per character.
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (currency === null || asset === undefined || Number(typedAmount) <= 0) {
      setEstimate("—");
      return;
    }
    clearTimeout(debounce.current);
    setEstimate("…");
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
        setEstimate(line?.available ? line.amount.display : "tidak tersedia");
      } catch {
        setEstimate("tidak tersedia");
      }
    }, 400);
    return () => clearTimeout(debounce.current);
  }, [typedAmount, currency, asset]);

  async function pay() {
    if (total === null && Number(amount) <= 0) {
      setError("Masukkan jumlah lebih dulu.");
      return;
    }
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`/v1/payment-links/${bootstrap.linkId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checkoutBody(bootstrap, amount, asset)),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error?.message ?? "Gagal membuat pembayaran");
        setBusy(false);
        return;
      }

      // Minting an intent does not lock a price or allocate a deposit address —
      // confirming it is what hands it to the clearing engine. The payment page
      // has nothing to show until this has run, so it runs before the redirect.
      const intentId: string = payload.paymentIntent.id;
      const confirmation = await fetch(`/v1/payment-intents/${intentId}/confirm`, {
        method: "POST",
      });
      const confirmed = await confirmation.json();
      if (!confirmation.ok) {
        setError(confirmed?.error?.message ?? "Gagal mengunci harga");
        setBusy(false);
        return;
      }
      if (confirmed.paymentIntent.status === "FAILED") {
        setError(confirmed.paymentIntent.failureReason ?? "Harga tidak bisa dikunci");
        setBusy(false);
        return;
      }

      location.href = `/checkout/pay/${intentId}`;
    } catch {
      setError("Jaringan bermasalah. Coba lagi.");
      setBusy(false);
    }
  }

  return (
    <main>
      <Brand />
      <div className="card">
        <h1>{bootstrap.title}</h1>
        <p className="muted">
          {bootstrap.merchant.name} · {bootstrap.merchant.city}
        </p>
        {total === null ? (
          <>
            <label className="label" htmlFor="amount">
              Jumlah
            </label>
            <div className="field">
              <span>{currency ?? ""}</span>
              <input
                id="amount"
                inputMode="decimal"
                placeholder="0"
                autoComplete="off"
                // biome-ignore lint/a11y/noAutofocus: typing the amount is the page's only task
                autoFocus
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
          </>
        ) : (
          <div className="figure" style={{ marginTop: 16 }}>
            {total.display}
          </div>
        )}
        {lines !== null && lines.length > 0 && (
          <div className="rows">
            {lines.map((line) => (
              <div className="row" key={`${line.name}-${line.unitPrice.amount}`}>
                <span>
                  {line.name} × {line.quantity}
                </span>
                <strong>{line.unitPrice.display}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
      {payable ? (
        <div className="card">
          <h2>Bayar pakai</h2>
          <div className="assets">
            {accepted.map((choice) => (
              <button
                type="button"
                className="asset"
                key={choice}
                aria-pressed={choice === asset}
                onClick={() => setAsset(choice)}
              >
                {choice}
              </button>
            ))}
          </div>
          <div className="rows">
            <div className="row">
              <span>Perkiraan</span>
              <strong>{estimate}</strong>
            </div>
          </div>
          <p className="subtle">
            Perkiraan, bukan harga final. Harga dikunci {lockMinutes} menit begitu kamu menekan
            tombol di bawah.
          </p>
          <button type="button" className="primary" disabled={busy} onClick={() => void pay()}>
            {busy ? "Menyiapkan pembayaran…" : "Lanjut bayar"}
          </button>
          {error !== "" && <p className="error">{error}</p>}
        </div>
      ) : (
        <div className="card">
          <p className="muted">Tautan ini sudah tidak berlaku.</p>
        </div>
      )}
    </main>
  );
}

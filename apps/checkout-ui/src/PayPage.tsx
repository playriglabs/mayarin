import { useCallback, useEffect, useRef, useState } from "react";
import { Brand } from "./Brand.tsx";
import { remainingAt } from "./countdown.ts";
import type { PayBootstrap, PaymentStatusPayload } from "./types.ts";
import { isTerminal, statusWording } from "./wording.ts";

type Deposit = NonNullable<PaymentStatusPayload["deposit"]>;

/**
 * The payment page: exactly what to send, where, and how long is left.
 *
 * Status arrives over Server-Sent Events and falls back to polling. The poll is
 * not dead code kept out of caution — it is the path a payer behind a proxy
 * that buffers streaming responses actually takes, and a payer who cannot
 * stream must still be able to pay.
 */
export function PayPage({ bootstrap }: { readonly bootstrap: PayBootstrap }) {
  const { intentId, expiresAt, statusUrl, streaming, successUrl, pollMs } = bootstrap;

  const [status, setStatus] = useState("memuat…");
  const [rawStatus, setRawStatus] = useState("");
  const [deposit, setDeposit] = useState<Deposit | undefined>(undefined);
  const [mode, setMode] = useState("");
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const pollTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const source = useRef<EventSource | undefined>(undefined);
  const terminal = isTerminal(rawStatus);

  const refresh = useCallback(async () => {
    const response = await fetch(statusUrl);
    if (!response.ok) return;
    const payload: PaymentStatusPayload = await response.json();
    const next = payload.paymentIntent.status;
    setRawStatus(next);
    setStatus(statusWording(next)[0]);
    if (payload.deposit !== undefined) setDeposit(payload.deposit);

    if (isTerminal(next)) {
      clearInterval(pollTimer.current);
      source.current?.close();
      if (next === "COMPLETED" && successUrl !== null) {
        setTimeout(() => location.assign(successUrl), 600);
      }
    }
  }, [statusUrl, successUrl]);

  // The clock. Stops once the payment is decided: the deadline is the payer's,
  // and once there is nothing left to be in time for, a running clock misleads.
  useEffect(() => {
    if (terminal) return;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [terminal]);

  useEffect(() => {
    void refresh();

    const startPolling = (reason: string) => {
      if (pollTimer.current !== undefined) return;
      setMode(reason);
      pollTimer.current = setInterval(() => void refresh(), pollMs);
    };

    if (streaming && "EventSource" in window) {
      const stream = new EventSource(`/checkout/events/${intentId}`);
      source.current = stream;
      stream.addEventListener("open", () => setMode("Diperbarui otomatis."));
      stream.addEventListener("payment", () => void refresh());
      // Falls back rather than retrying forever: EventSource reconnects on its
      // own, but a proxy that buffers the stream would leave the page silent.
      stream.addEventListener("error", () => startPolling("Memeriksa status berkala."));
    } else {
      startPolling("Memeriksa status berkala.");
    }

    return () => {
      clearInterval(pollTimer.current);
      source.current?.close();
    };
  }, [refresh, streaming, intentId, pollMs]);

  const remaining = remainingAt(expiresAt, now);
  const [, tone] = statusWording(rawStatus);

  return (
    <main>
      <Brand />
      <div className="card">
        <h1>{bootstrap.amount.display}</h1>
        <p className="muted">
          {bootstrap.merchant.name} · {bootstrap.merchant.city}
        </p>
        <div className="rows">
          <div className="row">
            <span>Status</span>
            <strong className="status">
              <i className={`dot ${tone}`} />
              <span style={{ color: "var(--ink)" }}>{status}</span>
            </strong>
          </div>
          <div className="row">
            <span>Berlaku sampai</span>
            <strong className={`countdown${remaining.low ? " low" : ""}`}>
              {terminal ? "—" : remaining.text}
            </strong>
          </div>
        </div>
      </div>
      {terminal ? (
        <Outcome status={rawStatus} />
      ) : deposit === undefined ? (
        <div className="card">
          <h2>Menyiapkan alamat pembayaran…</h2>
          <p className="subtle">Harga sedang dikunci. Jangan tutup halaman ini.</p>
        </div>
      ) : (
        <div className="card">
          <h2>Kirim tepat sejumlah ini</h2>
          <div className="figure">{deposit.amount.display}</div>
          {deposit.uri !== null && (
            <div className="qr">
              <img
                alt="QR pembayaran"
                src={`/checkout/qr?value=${encodeURIComponent(deposit.uri)}`}
              />
            </div>
          )}
          <div className="rows">
            <div className="row">
              <span>Jaringan</span>
              <strong>{deposit.chain}</strong>
            </div>
            <div className="row">
              <span>Alamat</span>
              <code>{deposit.address}</code>
            </div>
            <div className="row">
              <span>Sudah diterima</span>
              <strong>{deposit.received.display}</strong>
            </div>
          </div>
          <button
            type="button"
            className="copy"
            style={{ marginTop: 12 }}
            onClick={async () => {
              await navigator.clipboard.writeText(deposit.address);
              setCopied(true);
            }}
          >
            {copied ? "Tersalin" : "Salin alamat"}
          </button>
          <p className="subtle" style={{ marginTop: 12 }}>
            Kurang dari jumlah di atas tidak akan menyelesaikan pembayaran.
          </p>
        </div>
      )}
      {mode !== "" && (
        <p className="subtle" style={{ marginTop: 12 }}>
          {mode}
        </p>
      )}
      <p className="subtle">
        <code>{intentId}</code>
      </p>
    </main>
  );
}

/**
 * The end of the payment, in place of the deposit card.
 *
 * A finished payment must stop asking to be paid. Leaving the QR and address on
 * screen invites a second transfer to an address that will not clear it — the
 * same mistake in the failed and expired case as in the paid one, so all three
 * replace the card rather than only the happy path.
 */
function Outcome({ status }: { readonly status: string }) {
  const paid = status === "COMPLETED";
  const heading = paid
    ? "Pembayaran selesai"
    : status === "EXPIRED"
      ? "Masa berlaku habis"
      : "Pembayaran gagal";
  // Deliberately not the engine's own failure reason: that string names
  // clearing transactions and executor attempts — a sentence for an operator
  // reading the dashboard, not for the person holding the phone.
  const note = paid
    ? "Terima kasih sudah membayar. Kamu boleh menutup halaman ini."
    : "Mulai pembayaran baru untuk mencoba lagi.";

  return (
    <div className="card">
      <div className="outcome">
        <div className={`mark${paid ? "" : " bad"}`}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            {paid ? (
              <path
                d="M2 8.5 L6.5 13 L14 3"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="square"
              />
            ) : (
              <path
                d="M3 3 L13 13 M13 3 L3 13"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="square"
              />
            )}
          </svg>
        </div>
        <h2>{heading}</h2>
        <p>{note}</p>
      </div>
    </div>
  );
}

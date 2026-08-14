import { useCallback, useEffect, useRef, useState } from "react";
import { AssetLogo } from "./AssetLogo.tsx";
import { CheckoutSummary } from "./CheckoutSummary.tsx";
import { remainingAt } from "./countdown.ts";
import { usableDeposit } from "./payment-status.ts";
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

  const [status, setStatus] = useState("Loading…");
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
    const nextDeposit = usableDeposit(payload);
    if (nextDeposit !== undefined) setDeposit(nextDeposit);

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
      stream.addEventListener("open", () => setMode("Updates automatically."));
      stream.addEventListener("payment", () => void refresh());
      // Falls back rather than retrying forever: EventSource reconnects on its
      // own, but a proxy that buffers the stream would leave the page silent.
      stream.addEventListener("error", () => startPolling("Checking status periodically."));
    } else {
      startPolling("Checking status periodically.");
    }

    return () => {
      clearInterval(pollTimer.current);
      source.current?.close();
    };
  }, [refresh, streaming, intentId, pollMs]);

  const remaining = remainingAt(expiresAt, now);
  const [, tone] = statusWording(rawStatus);

  return (
    <main className="checkout-shell">
      <CheckoutSummary
        merchant={bootstrap.merchant}
        title={bootstrap.title}
        totalDisplay={bootstrap.amount.display}
        lines={bootstrap.lines}
      />
      <section className="checkout-panel" aria-label="Instruksi pembayaran">
        <div className="payment-form pay-detail">
          <div className="pay-heading">
            <div>
              <p className="section-kicker">Secure payment</p>
              <h2>{terminal ? "Payment status" : "Complete your payment"}</h2>
            </div>
            <div className={`timer${remaining.low ? " low" : ""}`}>
              <span>Time left</span>
              <strong>{terminal ? "—" : remaining.text}</strong>
            </div>
          </div>

          <div className="live-status" aria-live="polite">
            <i className={`dot ${tone}`} />
            <div>
              <span>Status</span>
              <strong>{status}</strong>
            </div>
          </div>

          <StatusTimeline status={rawStatus} />

          {terminal ? (
            <Outcome status={rawStatus} />
          ) : deposit === undefined ? (
            <div className="preparing">
              <span className="spinner" aria-hidden="true" />
              <div>
                <h3>Preparing your payment address…</h3>
                <p>Your price is being locked. Keep this page open.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="send-amount">
                <span>Send this exact amount</span>
                <strong>
                  <AssetLogo symbol={deposit.amount.asset} size={30} />
                  {deposit.amount.display}
                </strong>
              </div>
              {deposit.uri !== null && (
                <div className="qr">
                  <img
                    alt={`QR pembayaran ${deposit.amount.asset} di ${deposit.chain}`}
                    src={`/checkout/qr?value=${encodeURIComponent(deposit.uri)}`}
                  />
                </div>
              )}
              <dl className="payment-data">
                <div>
                  <dt>Local price</dt>
                  <dd>{bootstrap.amount.display}</dd>
                </div>
                <div>
                  <dt>Aset</dt>
                  <dd className="asset-value">
                    <AssetLogo symbol={deposit.amount.asset} size={18} />
                    {deposit.amount.asset}
                  </dd>
                </div>
                <div>
                  <dt>Network</dt>
                  <dd>{deposit.chain}</dd>
                </div>
                <div className="address-row">
                  <dt>Address</dt>
                  <dd>
                    <code>{deposit.address}</code>
                  </dd>
                </div>
                <div>
                  <dt>Amount received</dt>
                  <dd>{deposit.received.display}</dd>
                </div>
                <div>
                  <dt>Reference ID</dt>
                  <dd>
                    <code>{intentId}</code>
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                className="copy"
                onClick={async () => {
                  await navigator.clipboard.writeText(deposit.address);
                  setCopied(true);
                }}
              >
                {copied ? "Address copied" : "Copy payment address"}
              </button>
              <p className="estimate-note">
                Send only {deposit.amount.asset} on {deposit.chain}. A smaller amount or an asset on
                another network will not complete this payment.
              </p>
            </>
          )}

          {mode !== "" && <p className="connection-mode">{mode}</p>}
          {deposit === undefined && (
            <p className="reference">
              Reference ID <code>{intentId}</code>
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

function StatusTimeline({ status }: { readonly status: string }) {
  const order = ["PENDING", "CONFIRMED", "PROCESSING", "COMPLETED"] as const;
  const labels = ["Waiting for payment", "Asset received", "Processing", "Completed"] as const;
  const current = order.indexOf(status as (typeof order)[number]);
  const failed = status === "FAILED" || status === "EXPIRED";

  return (
    <ol className="status-timeline" aria-label="Progres pembayaran">
      {labels.map((label, index) => (
        <li
          className={
            failed ? "failed" : index < current ? "complete" : index === current ? "current" : ""
          }
          key={label}
          aria-current={index === current ? "step" : undefined}
        >
          <i aria-hidden="true" />
          <span>{label}</span>
        </li>
      ))}
    </ol>
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
    ? "Payment completed"
    : status === "EXPIRED"
      ? "Payment expired"
      : "Payment failed";
  // Deliberately not the engine's own failure reason: that string names
  // clearing transactions and executor attempts — a sentence for an operator
  // reading the dashboard, not for the person holding the phone.
  const note = paid
    ? "Thank you. You can safely close this page."
    : "Start a new payment to try again.";

  return (
    <div className="outcome-wrap">
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

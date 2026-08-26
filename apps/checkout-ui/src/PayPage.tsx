import { useCallback, useEffect, useRef, useState } from "react";
import { AssetLogo } from "./AssetLogo.tsx";
import { walletAmount } from "./amount.ts";
import { CheckoutSummary } from "./CheckoutSummary.tsx";
import { remainingAt } from "./countdown.ts";
import { usableDeposit } from "./payment-status.ts";
import type { PayBootstrap, PaymentStatusPayload } from "./types.ts";
import { isTerminal, type PaymentStage, paymentStage } from "./wording.ts";

type Deposit = NonNullable<PaymentStatusPayload["deposit"]>;

type CopyTarget = "amount" | "address";

/**
 * The payment page: exactly what to send, where, and how long is left.
 *
 * Status arrives over Server-Sent Events and falls back to polling. The poll is
 * not dead code kept out of caution — it is the path a payer behind a proxy
 * that buffers streaming responses actually takes, and a payer who cannot
 * stream must still be able to pay.
 *
 * A terminal payment replaces the whole live surface: the countdown, the
 * timeline, and the update note all leave with the deposit card, because a
 * decided payment must stop looking like one that is still waiting.
 */
export function PayPage({ bootstrap }: { readonly bootstrap: PayBootstrap }) {
  const { intentId, expiresAt, statusUrl, streaming, successUrl, pollMs } = bootstrap;

  const [rawStatus, setRawStatus] = useState("");
  const [clearingState, setClearingState] = useState("");
  const [deposit, setDeposit] = useState<Deposit | undefined>(undefined);
  const [copied, setCopied] = useState<CopyTarget | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());

  const pollTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const source = useRef<EventSource | undefined>(undefined);
  const terminal = isTerminal(rawStatus);
  const stage = paymentStage(clearingState);

  const refresh = useCallback(async () => {
    const response = await fetch(statusUrl);
    if (!response.ok) return;
    const payload: PaymentStatusPayload = await response.json();
    const next = payload.paymentIntent.status;
    setRawStatus(next);
    setClearingState(payload.clearing?.state ?? "");

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

    const startPolling = () => {
      if (pollTimer.current !== undefined) return;
      pollTimer.current = setInterval(() => void refresh(), pollMs);
    };

    if (streaming && "EventSource" in window) {
      const stream = new EventSource(`/checkout/events/${intentId}`);
      source.current = stream;
      stream.addEventListener("payment", () => void refresh());
      // Falls back rather than retrying forever: EventSource reconnects on its
      // own, but a proxy that buffers the stream would leave the page silent.
      stream.addEventListener("error", startPolling);
    } else {
      startPolling();
    }

    return () => {
      clearInterval(pollTimer.current);
      source.current?.close();
    };
  }, [refresh, streaming, intentId, pollMs]);

  // A payer who pays in a wallet extension takes focus away from this page.
  // Refetching the moment they come back beats waiting out the poll interval:
  // the first thing they look for is whether their payment was noticed.
  useEffect(() => {
    if (terminal) return;
    const wake = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [terminal, refresh]);

  // The copied confirmation reverts on its own, so the button reads as an
  // action again rather than as a permanent state.
  useEffect(() => {
    if (copied === undefined) return;
    const timer = setTimeout(() => setCopied(undefined), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = (target: CopyTarget, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(target);
  };

  const remaining = remainingAt(expiresAt, now);

  return (
    <main className="checkout-shell">
      <CheckoutSummary
        merchant={bootstrap.merchant}
        title={bootstrap.title}
        totalDisplay={bootstrap.amount.display}
        lines={bootstrap.lines}
      />
      <section className="checkout-panel" aria-label="Payment instructions">
        <div className="payment-form pay-detail">
          {!terminal && (
            <div className="pay-heading">
              <div>
                <p className="section-kicker">Secure payment</p>
                <h2>Complete your payment</h2>
              </div>
              {stage === "waiting" && (
                <div className={`timer${remaining.low ? " low" : ""}`}>
                  <span>Time left</span>
                  <strong>{remaining.text}</strong>
                </div>
              )}
            </div>
          )}

          {!terminal && <StatusTimeline stage={stage} />}

          {terminal ? (
            <Outcome status={rawStatus} intentId={intentId} />
          ) : deposit === undefined ? (
            <div className="preparing">
              <span className="spinner" aria-hidden="true" />
              <div>
                <h3>Preparing your payment address…</h3>
                <p>Your price is being locked. Keep this page open.</p>
              </div>
            </div>
          ) : stage === "confirming" ? (
            <ConfirmingCard deposit={deposit} />
          ) : (
            <DepositCard
              deposit={deposit}
              localPrice={bootstrap.amount.display}
              intentId={intentId}
              copied={copied}
              onCopy={copy}
            />
          )}

          {!terminal && <p className="connection-mode">This page updates automatically.</p>}
          {!terminal && (deposit === undefined || stage === "confirming") && (
            <p className="reference">
              Reference ID <code>{intentId}</code>
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

/**
 * What to send and where. Both values a payer must reproduce in a wallet — the
 * amount and the address — render in machine form and carry a copy button.
 * The localized `display` form appears only on the fiat "Local price" row.
 */
export function DepositCard({
  deposit,
  localPrice,
  intentId,
  copied,
  onCopy,
}: {
  readonly deposit: Deposit;
  readonly localPrice: string;
  readonly intentId: string;
  readonly copied: CopyTarget | undefined;
  readonly onCopy: (target: CopyTarget, text: string) => void;
}) {
  const amount = walletAmount(deposit.amount.formatted);

  return (
    <>
      <div className="send-amount">
        <span>Send this exact amount</span>
        {/* The amount and its copy button read as one unit, so they share a
            row rather than the button spanning the card. */}
        <div className="amount-row">
          <strong>
            <AssetLogo symbol={deposit.amount.asset} size={30} />
            {amount} {deposit.amount.asset}
          </strong>
          <button
            type="button"
            className="copy copy-inline"
            // Icon-only, so the label carries the whole message — including the
            // confirmation, which a sighted payer reads from the check glyph.
            aria-label={copied === "amount" ? "Amount copied" : `Copy the amount ${amount}`}
            onClick={() => onCopy("amount", amount)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              {copied === "amount" ? (
                <path
                  d="M2.5 8.5 L6.5 12.5 L13.5 3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="square"
                />
              ) : (
                <>
                  <rect
                    x="6"
                    y="6"
                    width="7.5"
                    height="7.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                  <path
                    d="M10 6 V2.5 H2.5 V10 H6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>
      {deposit.uri !== null && (
        <div className="qr">
          <img
            alt={`QR payment ${deposit.amount.asset} at ${deposit.chain}`}
            src={`/checkout/qr?value=${encodeURIComponent(deposit.uri)}`}
          />
        </div>
      )}
      <dl className="payment-data">
        <div>
          <dt>Local price</dt>
          <dd>{localPrice}</dd>
        </div>
        <div>
          <dt>Asset</dt>
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
          <dd>
            {walletAmount(deposit.received.formatted)} {deposit.received.asset}
          </dd>
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
        aria-label="Copy the payment address"
        onClick={() => onCopy("address", deposit.address)}
      >
        {copied === "address" ? "Address copied" : "Copy payment address"}
      </button>
      <p className="estimate-note">
        Send only {deposit.amount.asset} on {deposit.chain}. A smaller amount or an asset on another
        network will not complete this payment.
      </p>
    </>
  );
}

/**
 * The moment the money arrives, the page must stop asking to be paid.
 *
 * This card replaces the deposit card — amount, QR, address, copy buttons all
 * leave — because every one of them invites a second transfer. `role="status"`
 * makes the transition audible to a screen reader without stealing focus.
 */
export function ConfirmingCard({ deposit }: { readonly deposit: Deposit }) {
  const received = walletAmount(deposit.received.formatted);

  return (
    <div className="preparing" role="status">
      <span className="spinner" aria-hidden="true" />
      <div>
        <h3>Payment detected</h3>
        <p>
          Your {deposit.amount.asset} arrived on {deposit.chain} and is being confirmed. This takes
          a moment.
        </p>
        {deposit.received.amount !== "0" && (
          <p className="received-note">
            {received} {deposit.received.asset} received
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The payer's model of the payment, not the machine's. Three steps cover the
 * whole pending phase; the terminal phase never reaches this component — the
 * outcome card replaces the entire live surface.
 *
 * The current step is driven by the clearing stage, never by the intent
 * status: an intent is `CONFIRMED` the moment the payer presses Continue,
 * long before any money moves.
 */
function StatusTimeline({ stage }: { readonly stage: PaymentStage }) {
  const labels = ["Waiting for payment", "Confirming", "Done"] as const;
  const current = stage === "confirming" ? 1 : 0;

  return (
    <ol className="status-timeline" aria-label="Payment progress">
      {labels.map((label, index) => (
        <li
          className={index < current ? "complete" : index === current ? "current" : ""}
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
export function Outcome({
  status,
  intentId,
}: {
  readonly status: string;
  readonly intentId: string;
}) {
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
        <p className="pt-2">{note}</p>
        <p className="reference">
          Reference ID <code>{intentId}</code>
        </p>
      </div>
    </div>
  );
}

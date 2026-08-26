import { useCallback, useEffect, useRef, useState } from "react";
import { usableDeposit } from "./payment-status.ts";
import { isTerminal } from "./status-wording.ts";
import type { Deposit, PayBootstrap, PaymentStatusPayload } from "./types.ts";

export interface LiveStatus {
  readonly status: string;
  readonly clearingState: string;
  readonly deposit: Deposit | undefined;
  readonly terminal: boolean;
}

/**
 * The payment as the server sees it, kept current.
 *
 * Status arrives over Server-Sent Events and falls back to polling. The poll is
 * not dead code kept out of caution — it is the path a payer behind a proxy
 * that buffers streaming responses actually takes, and a payer who cannot
 * stream must still be able to pay.
 *
 * A payer who pays in a wallet extension takes focus away from this page.
 * Refetching the moment they come back beats waiting out the poll interval:
 * the first thing they look for is whether their payment was noticed.
 */
export function usePaymentStatus(bootstrap: PayBootstrap): LiveStatus {
  const { intentId, statusUrl, streaming, successUrl, pollMs } = bootstrap;

  const [status, setStatus] = useState("");
  const [clearingState, setClearingState] = useState("");
  const [deposit, setDeposit] = useState<Deposit | undefined>(undefined);

  const pollTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const source = useRef<EventSource | undefined>(undefined);
  const terminal = isTerminal(status);

  const refresh = useCallback(async () => {
    const response = await fetch(statusUrl);
    if (!response.ok) return;
    const payload: PaymentStatusPayload = await response.json();
    const next = payload.paymentIntent.status;
    setStatus(next);
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

  return { status, clearingState, deposit, terminal };
}

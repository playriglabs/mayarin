import clsx from "clsx";
import { match, P } from "ts-pattern";
import { CheckoutSummary } from "../../shared/checkout-summary.tsx";
import { ConfirmingCard } from "./confirming-card.tsx";
import { DepositCard } from "./deposit-card.tsx";
import { Outcome } from "./outcome.tsx";
import { StatusTimeline } from "./status-timeline.tsx";
import { paymentStage } from "./status-wording.ts";
import type { PayBootstrap } from "./types.ts";
import { useCopy } from "./use-copy.ts";
import { useCountdown } from "./use-countdown.ts";
import { usePaymentStatus } from "./use-payment-status.ts";

/**
 * The payment page: exactly what to send, where, and how long is left.
 *
 * A terminal payment replaces the whole live surface: the countdown, the
 * timeline, and the update note all leave with the deposit card, because a
 * decided payment must stop looking like one that is still waiting.
 *
 * The live body is one exhaustive match over `{terminal, deposit, stage}` —
 * the same facts the ternary chain read, but the compiler now proves every
 * case is covered, so a new payment stage cannot fall through to the deposit
 * card silently.
 */
export function PayPage({ bootstrap }: { readonly bootstrap: PayBootstrap }) {
  const { intentId, expiresAt } = bootstrap;

  const { status, clearingState, deposit, terminal } = usePaymentStatus(bootstrap);
  const remaining = useCountdown(expiresAt, !terminal);
  const { copied, copy } = useCopy();
  const stage = paymentStage(clearingState);

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
                <div className={clsx("timer", { low: remaining.low })}>
                  <span>Time left</span>
                  <strong>{remaining.text}</strong>
                </div>
              )}
            </div>
          )}

          {!terminal && <StatusTimeline stage={stage} />}

          {match({ terminal, deposit, stage })
            .with({ terminal: true }, () => <Outcome status={status} intentId={intentId} />)
            .with({ deposit: P.nullish }, () => (
              <div className="preparing">
                <span className="spinner" aria-hidden="true" />
                <div>
                  <h3>Preparing your payment address…</h3>
                  <p>Your price is being locked. Keep this page open.</p>
                </div>
              </div>
            ))
            .with({ deposit: P.nonNullable, stage: "confirming" }, ({ deposit }) => (
              <ConfirmingCard deposit={deposit} />
            ))
            .with({ deposit: P.nonNullable, stage: "waiting" }, ({ deposit }) => (
              <DepositCard
                deposit={deposit}
                localPrice={bootstrap.amount.display}
                intentId={intentId}
                copied={copied}
                onCopy={copy}
              />
            ))
            .exhaustive()}

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

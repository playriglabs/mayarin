import clsx from "clsx";
import { match, P } from "ts-pattern";
import { CheckoutSummary } from "../../shared/checkout-summary.tsx";
import { ChooseRail } from "./choose-rail.tsx";
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
 * The payment page: how to pay first, when that is still open, then exactly
 * what to send, where, and how long is left.
 *
 * An intent minted without a rail — a storefront's cart checkout — asks the
 * payer to choose one before anything else. Without that step the page waited
 * on a deposit address that could never be allocated.
 */
export function PayPage({ bootstrap }: { readonly bootstrap: PayBootstrap }) {
  if (bootstrap.choice !== null) {
    return (
      <main className="checkout-shell">
        <CheckoutSummary
          merchant={bootstrap.merchant}
          title={bootstrap.title}
          totalDisplay={bootstrap.amount.display}
          lines={bootstrap.lines}
        />
        <section className="checkout-panel" aria-label="Payment details">
          <ChooseRail bootstrap={bootstrap} choice={bootstrap.choice} />
        </section>
      </main>
    );
  }
  return <LivePayment bootstrap={bootstrap} />;
}

/**
 * The live payment: timeline, countdown, and the deposit to send — or, once
 * money has arrived or the payment has ended, a picture and a sentence in
 * place of every instruction that would invite a second transfer.
 *
 * The timeline sits under the order on a wide screen, where the summary column
 * has room, and above the payment on a narrow one. Rendered in both places and
 * shown in one: `display: none` also hides the other from a screen reader.
 *
 * The body is one exhaustive match over `{terminal, deposit, stage}` — the
 * compiler proves every case is covered, so a new payment stage cannot fall
 * through to the deposit card silently.
 */
function LivePayment({ bootstrap }: { readonly bootstrap: PayBootstrap }) {
  const { intentId, expiresAt } = bootstrap;

  const { status, clearingState, deposit, terminal } = usePaymentStatus(bootstrap);
  const remaining = useCountdown(expiresAt, !terminal);
  const { copied, copy } = useCopy();
  const stage = paymentStage(clearingState);
  const waiting = !terminal && stage === "waiting";

  return (
    <main className="checkout-shell">
      <CheckoutSummary
        merchant={bootstrap.merchant}
        title={bootstrap.title}
        totalDisplay={bootstrap.amount.display}
        lines={bootstrap.lines}
      >
        <StatusTimeline status={status} stage={stage} className="timeline-wide" />
      </CheckoutSummary>
      <section className="checkout-panel" aria-label="Payment instructions">
        <div className="payment-form pay-detail">
          <StatusTimeline status={status} stage={stage} className="timeline-narrow" />

          {waiting && (
            <div className="pay-heading">
              <div>
                <p className="section-kicker">Secure payment</p>
                <h2>Complete your payment</h2>
              </div>
              <div className={clsx("timer", { low: remaining.low })}>
                <span>Time left</span>
                <strong>{remaining.text}</strong>
              </div>
            </div>
          )}

          {match({ terminal, deposit, stage })
            .with({ terminal: true }, () => (
              <Outcome
                status={status}
                intentId={intentId}
                statusUrl={bootstrap.statusUrl}
                merchantName={bootstrap.merchant.name}
                escrowed={bootstrap.escrow !== null}
              />
            ))
            .with({ deposit: P.nullish }, () => (
              <div className="preparing" role="status">
                <span className="spinner" aria-hidden="true" />
                <div>
                  <h3>Preparing your payment address…</h3>
                  <p>Your price is being locked. Keep this page open.</p>
                </div>
              </div>
            ))
            .with({ deposit: P.nonNullable, stage: "confirming" }, ({ deposit }) => (
              <ConfirmingCard deposit={deposit} intentId={intentId} />
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
          {waiting && deposit === undefined && (
            <p className="reference">
              Reference ID <code>{intentId}</code>
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

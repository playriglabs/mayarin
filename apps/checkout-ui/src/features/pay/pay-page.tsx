import clsx from "clsx";
import { match, P } from "ts-pattern";
import { CheckoutShell } from "../../shared/checkout-shell.tsx";
import { CheckoutSummary } from "../../shared/checkout-summary.tsx";
import { footnote, panelTitle } from "../../shared/ui.ts";
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
      <CheckoutShell
        label="Payment details"
        summary={
          <CheckoutSummary
            merchant={bootstrap.merchant}
            title={bootstrap.title}
            totalDisplay={bootstrap.amount.display}
            lines={bootstrap.lines}
          />
        }
      >
        <ChooseRail bootstrap={bootstrap} choice={bootstrap.choice} />
      </CheckoutShell>
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
    <CheckoutShell
      label="Payment instructions"
      summary={
        <CheckoutSummary
          merchant={bootstrap.merchant}
          title={bootstrap.title}
          totalDisplay={bootstrap.amount.display}
          lines={bootstrap.lines}
        >
          <StatusTimeline status={status} stage={stage} className="mt-10 hidden lg:grid" />
        </CheckoutSummary>
      }
    >
      <StatusTimeline status={status} stage={stage} className="mb-8 lg:hidden" />

      {waiting && (
        <div className="flex items-center justify-between gap-4">
          <h2 className={panelTitle}>Complete your payment</h2>
          <span
            className={clsx(
              "inline-flex shrink-0 items-baseline gap-1.5 rounded-full border px-3 py-1 text-xs",
              remaining.low ? "border-danger/40 text-danger" : "border-line text-muted",
            )}
          >
            Time left
            <strong className="text-sm font-medium text-ink tabular-nums">{remaining.text}</strong>
          </span>
        </div>
      )}

      {match({ terminal, deposit, stage })
        .with({ terminal: true }, () => (
          <Outcome
            status={status}
            intentId={intentId}
            statusUrl={bootstrap.statusUrl}
            merchantName={bootstrap.merchant.name}
            escrowed={bootstrap.escrowed}
          />
        ))
        .with({ deposit: P.nullish }, () => (
          <div className="mt-8 flex items-center gap-3.5 py-6" role="status">
            <span
              className="size-5.5 shrink-0 animate-spin rounded-full border-2 border-line border-t-ink motion-reduce:animate-none"
              aria-hidden="true"
            />
            <div>
              <h3 className="m-0 text-sm font-medium">Preparing your payment address…</h3>
              <p className="mt-1 mb-0 text-xs text-muted">
                Your price is being locked. Keep this page open.
              </p>
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

      {!terminal && <p className={footnote}>This page updates automatically.</p>}
      {waiting && deposit === undefined && (
        <p className={footnote}>
          Reference ID <code>{intentId}</code>
        </p>
      )}
    </CheckoutShell>
  );
}

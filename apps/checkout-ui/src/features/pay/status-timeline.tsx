import { match, P } from "ts-pattern";
import type { PaymentStage } from "./status-wording.ts";

/**
 * The payer's model of the payment, not the machine's. Three steps cover the
 * whole pending phase; the terminal phase never reaches this component — the
 * outcome card replaces the entire live surface.
 *
 * The current step is driven by the clearing stage, never by the intent
 * status: an intent is `CONFIRMED` the moment the payer presses Continue,
 * long before any money moves.
 */
export function StatusTimeline({ stage }: { readonly stage: PaymentStage }) {
  const labels = ["Waiting for payment", "Confirming", "Done"] as const;
  const current = stage === "confirming" ? 1 : 0;

  return (
    <ol className="status-timeline" aria-label="Payment progress">
      {labels.map((label, index) => (
        <li
          className={match(current - index)
            .returnType<string>()
            .with(P.number.positive(), () => "complete")
            .with(0, () => "current")
            .otherwise(() => "")}
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

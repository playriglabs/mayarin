import clsx from "clsx";
import type { PaymentStage } from "./status-wording.ts";

type StepState = "done" | "current" | "upcoming" | "bad";

interface Step {
  readonly label: string;
  readonly state: StepState;
}

/**
 * The payer's model of the payment, not the machine's: three steps, and the
 * last one says how it ended.
 *
 * The current step is driven by the clearing stage, never by the intent
 * status: an intent is `CONFIRMED` the moment the payer presses Continue,
 * long before any money moves. Only a terminal status overrides it.
 */
export function timelineSteps(status: string, stage: PaymentStage): readonly Step[] {
  if (status === "COMPLETED") {
    return [
      { label: "Waiting for payment", state: "done" },
      { label: "Processing payment", state: "done" },
      { label: "Payment successful", state: "done" },
    ];
  }
  if (status === "FAILED") {
    return [
      { label: "Waiting for payment", state: "done" },
      { label: "Processing payment", state: "done" },
      { label: "Payment failed", state: "bad" },
    ];
  }
  if (status === "EXPIRED") {
    return [
      { label: "Payment expired", state: "bad" },
      { label: "Processing payment", state: "upcoming" },
      { label: "Success", state: "upcoming" },
    ];
  }
  return stage === "confirming"
    ? [
        { label: "Waiting for payment", state: "done" },
        { label: "Processing payment", state: "current" },
        { label: "Success", state: "upcoming" },
      ]
    : [
        { label: "Waiting for payment", state: "current" },
        { label: "Processing payment", state: "upcoming" },
        { label: "Success", state: "upcoming" },
      ];
}

/** Vertical, one step per row, joined by a line that fills as the payment moves. */
export function StatusTimeline({
  status,
  stage,
  className,
}: {
  readonly status: string;
  readonly stage: PaymentStage;
  readonly className?: string;
}) {
  return (
    <ol className={clsx("status-timeline", className)} aria-label="Payment progress">
      {timelineSteps(status, stage).map((step) => (
        <li
          className={step.state}
          key={step.label}
          aria-current={step.state === "current" ? "step" : undefined}
        >
          <StepIcon state={step.state} />
          <span>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

function StepIcon({ state }: { readonly state: StepState }) {
  return (
    <span className="step-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {state === "done" && <path d="M7 12.5 l3.5 3.5 L17 9" className="step-glyph" />}
        {state === "bad" && <path d="M12 7 v6 M12 16.5 v0.5" className="step-glyph" />}
        {state === "current" && (
          <circle cx="12" cy="12" r="5" className="step-spin" pathLength="100" />
        )}
        {state === "upcoming" && <circle cx="12" cy="12" r="2.5" className="step-dot" />}
      </svg>
    </span>
  );
}

import clsx from "clsx";
import { type Translate, translateEnglish, useT } from "../../i18n/index.tsx";
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
export function timelineSteps(
  status: string,
  stage: PaymentStage,
  t: Translate = translateEnglish,
): readonly Step[] {
  if (status === "COMPLETED") {
    return [
      { label: t("stepWaiting"), state: "done" },
      { label: t("stepProcessing"), state: "done" },
      { label: t("stepSuccessful"), state: "done" },
    ];
  }
  if (status === "FAILED") {
    return [
      { label: t("stepWaiting"), state: "done" },
      { label: t("stepProcessing"), state: "done" },
      { label: t("paymentFailed"), state: "bad" },
    ];
  }
  if (status === "EXPIRED") {
    return [
      { label: t("paymentExpired"), state: "bad" },
      { label: t("stepProcessing"), state: "upcoming" },
      { label: t("stepSuccess"), state: "upcoming" },
    ];
  }
  return stage === "confirming"
    ? [
        { label: t("stepWaiting"), state: "done" },
        { label: t("stepProcessing"), state: "current" },
        { label: t("stepSuccess"), state: "upcoming" },
      ]
    : [
        { label: t("stepWaiting"), state: "current" },
        { label: t("stepProcessing"), state: "upcoming" },
        { label: t("stepSuccess"), state: "upcoming" },
      ];
}

const LABEL_CLASS: Record<StepState, string> = {
  done: "text-muted",
  current: "text-ink",
  bad: "text-ink",
  upcoming: "text-subtle",
};

const ICON_CLASS: Record<StepState, string> = {
  done: "border-brand bg-brand text-panel",
  current: "border-brand/35 text-brand",
  bad: "border-danger bg-danger text-panel",
  upcoming: "border-line text-subtle",
};

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
  const t = useT();
  const steps = timelineSteps(status, stage, t);
  return (
    <ol className={clsx("m-0 grid list-none p-0", className)} aria-label={t("paymentProgress")}>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <li
            className={clsx(
              "relative flex items-start gap-3.5 text-sm",
              last ? "min-h-0" : "min-h-14",
              LABEL_CLASS[step.state],
            )}
            key={step.label}
            aria-current={step.state === "current" ? "step" : undefined}
          >
            {!last && (
              <span
                aria-hidden="true"
                className={clsx(
                  "absolute top-8 bottom-1 left-[15px] w-0.5 rounded-full",
                  step.state === "done" ? "bg-brand" : "bg-line",
                )}
              />
            )}
            <StepIcon state={step.state} />
            <span className="pt-1.5 leading-5">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function StepIcon({ state }: { readonly state: StepState }) {
  return (
    <span
      className={clsx(
        "grid size-8 shrink-0 place-items-center rounded-full border-2",
        ICON_CLASS[state],
      )}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-6 fill-none stroke-current"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {state === "done" && <path d="M7 12.5 l3.5 3.5 L17 9" />}
        {state === "bad" && <path d="M12 7 v6 M12 16.5 v0.5" />}
        {state === "current" && (
          <circle
            cx="12"
            cy="12"
            r="5"
            pathLength="100"
            strokeDasharray="60 40"
            className="origin-center [transform-box:fill-box] motion-safe:animate-spin"
          />
        )}
        {state === "upcoming" && (
          <circle cx="12" cy="12" r="2.5" className="fill-current stroke-0" />
        )}
      </svg>
    </span>
  );
}

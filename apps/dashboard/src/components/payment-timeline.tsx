/**
 * Clearing timeline — the nine-state machine drawn as a horizontal rail that
 * wraps. Time reads the way the machine runs: CREATED at the left, SUCCESS at
 * the right, wrapping onto the next row when the viewport is narrow.
 *
 * Every state is rendered, not only the ones reached, so a merchant can see
 * what is still ahead of a payment rather than inferring it from an empty
 * space. A state that has been reached carries the timestamp its event
 * recorded; the rest are dimmed and marked `aria-disabled`.
 *
 * The segment after each dot is the rail. It fills up to the furthest
 * transition that actually happened — a segment is filled when the step it
 * leads TO has been reached — and the fill turns destructive on a failed
 * payment, matching the red terminal node.
 *
 * `FAILED` is reachable from any non-terminal state, so it is never a step on
 * the rail. It is appended as a terminal node after the whole rail, and the
 * sentence under the rail says why.
 *
 * The current step's explanation renders once, under the rail, rather than
 * under every step — nine sentences in a wrapping grid is noise, and the one
 * that matters is the step the payment is actually on.
 */

import { CheckIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { HAPPY_PATH, isFailed, STATE_COPY, stepIndex } from "@/lib/clearing";
import { formatDateTime, isoAttr } from "@/lib/date";
import { EASE_OUT_EXPO, ENTER_DURATION } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { TimelineEvent } from "@/types/payment";

/** Gap between consecutive step entrances. Small: nine steps add up fast. */
const STAGGER = 0.03;

type StepStatus = "done" | "current" | "upcoming";

interface Step {
  readonly state: string;
  readonly label: string;
  readonly detail: string;
  readonly status: StepStatus;
  readonly occurredAt: string | undefined;
}

function buildSteps(events: readonly TimelineEvent[], currentState: string): readonly Step[] {
  const seen = new Map<string, string>();
  for (const event of events) seen.set(event.state, event.occurredAt);

  // With FAILED as the current state the last happy-path state that has an
  // event is the furthest the payment actually got.
  const reachedIndex = HAPPY_PATH.reduce(
    (acc, state, index) => (seen.has(state) ? index : acc),
    -1,
  );
  const currentIndex = isFailed(currentState) ? reachedIndex : stepIndex(currentState);

  // The last happy-path state is TERMINAL: a payment sitting on `SUCCESS` is
  // finished, not in progress. Rendering it as the current step left the final
  // item permanently unchecked on a payment that had completed.
  const terminalIndex = HAPPY_PATH.length - 1;

  return HAPPY_PATH.map((state, index) => ({
    state,
    label: STATE_COPY[state].label,
    detail: STATE_COPY[state].detail,
    status:
      index < currentIndex || (index === currentIndex && index === terminalIndex)
        ? "done"
        : index === currentIndex
          ? "current"
          : "upcoming",
    occurredAt: seen.get(state),
  }));
}

const DOT: Readonly<Record<StepStatus, string>> = {
  done: "border-brand bg-brand text-brand-foreground",
  current: "border-brand bg-card text-brand",
  upcoming: "border-input bg-card text-subtle-foreground",
};

export default function PaymentTimeline({
  events,
  currentState,
  failureReason,
}: {
  events: readonly TimelineEvent[];
  currentState: string;
  failureReason?: string | undefined;
}) {
  const steps = buildSteps(events, currentState);
  const failed = isFailed(currentState);
  const current = steps.find((step) => step.status === "current");
  const terminal = steps[steps.length - 1];

  return (
    <div className="flex flex-col gap-5">
      <ol className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-y-6">
        {steps.map((step, index) => {
          // The segment leads to the NEXT step, so it fills once that step has
          // been reached. The very last segment leads to the FAILED node.
          const next = steps[index + 1];
          const filled =
            next !== undefined ? next.status !== "upcoming" : failed && step.status !== "upcoming";
          const lastCell = index === steps.length - 1 && !failed;
          return (
            <motion.li
              key={step.state}
              className="flex min-w-0 flex-col gap-2"
              aria-current={step.status === "current" ? "step" : undefined}
              aria-disabled={step.status === "upcoming" ? true : undefined}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: ENTER_DURATION,
                delay: index * STAGGER,
                ease: EASE_OUT_EXPO,
              }}
            >
              <div className="flex items-center">
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center border",
                    DOT[step.status],
                  )}
                >
                  {step.status === "done" ? (
                    <CheckIcon size={12} weight="bold" />
                  ) : (
                    <span
                      className={cn(
                        "size-1.5",
                        step.status === "current" ? "bg-brand" : "bg-input",
                      )}
                    />
                  )}
                </span>
                {!lastCell && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-px flex-1",
                      filled ? (failed ? "bg-destructive" : "bg-brand") : "bg-border",
                    )}
                  />
                )}
              </div>

              <div className="flex min-w-0 flex-col gap-0.5 pr-3">
                <span
                  className={cn(
                    "text-sm",
                    step.status === "upcoming"
                      ? "text-subtle-foreground"
                      : "font-medium text-foreground",
                  )}
                >
                  {step.label}
                </span>
                {step.occurredAt !== undefined ? (
                  <time
                    dateTime={isoAttr(step.occurredAt)}
                    className="text-xs text-subtle-foreground"
                  >
                    {formatDateTime(step.occurredAt)}
                  </time>
                ) : (
                  <span aria-hidden="true" className="text-xs text-subtle-foreground">
                    —
                  </span>
                )}
              </div>
            </motion.li>
          );
        })}

        {failed && (
          <motion.li
            className="flex min-w-0 flex-col gap-2"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: ENTER_DURATION,
              delay: steps.length * STAGGER,
              ease: EASE_OUT_EXPO,
            }}
          >
            <div className="flex items-center">
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center border border-destructive bg-destructive text-destructive-foreground"
              >
                <XIcon size={12} weight="bold" />
              </span>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5 pr-3">
              <span className="text-sm font-medium text-destructive">
                {STATE_COPY.FAILED.label}
              </span>
            </div>
          </motion.li>
        )}
      </ol>

      {failed ? (
        <p className="flex items-start gap-1.5 border-t border-border pt-4 text-xs text-muted-foreground">
          <WarningIcon size={14} aria-hidden="true" className="mt-px shrink-0 text-destructive" />
          {failureReason ?? STATE_COPY.FAILED.detail}
        </p>
      ) : (
        <p className="border-t border-border pt-4 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{(current ?? terminal)?.label}.</span>{" "}
          {(current ?? terminal)?.detail}
        </p>
      )}
    </div>
  );
}

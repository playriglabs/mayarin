/**
 * Clearing timeline — the nine-state machine drawn as a rail.
 *
 * Every state is rendered, not only the ones reached, so a merchant can see
 * what is still ahead of a payment rather than inferring it from an empty
 * space. A state that has been reached carries the timestamp its event
 * recorded; the rest are dimmed and marked `aria-disabled`.
 *
 * `FAILED` is reachable from any non-terminal state, so it is never drawn as a
 * step on the rail. It is appended as a terminal node after the last state that
 * was actually reached, which is where it truthfully belongs.
 *
 * Motion: the rail grows once on mount and steps fade in on a short stagger,
 * timed from `lib/motion` so this matches every other animated surface.
 * `MotionProvider` collapses both to a plain cut for a reader who asked for
 * reduced motion — the states still appear, they simply do not travel.
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
  done: "border-brand bg-brand text-white",
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
  // The filled rail stops at the last completed dot, measured between dot
  // centres. Taken from the last done INDEX rather than a count, because a
  // completed payment has every step done and a count would overrun the rail.
  const lastDoneIndex = steps.reduce(
    (acc, step, index) => (step.status === "done" ? index : acc),
    0,
  );
  const filledFraction = steps.length <= 1 ? 0 : lastDoneIndex / (steps.length - 1);

  return (
    <div className="relative flex flex-col">
      {/* Rail. Sits behind the dots and never receives a pointer or a reader. */}
      <div aria-hidden="true" className="absolute top-3 bottom-3 left-2.75 w-px bg-border" />
      <motion.div
        aria-hidden="true"
        className={cn(
          "absolute top-3 left-2.75 w-px origin-top",
          failed ? "bg-destructive" : "bg-brand",
        )}
        style={{ height: `calc((100% - 1.5rem) * ${filledFraction})` }}
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ duration: ENTER_DURATION * 1.5, ease: EASE_OUT_EXPO }}
      />

      <ol className="flex flex-col">
        {steps.map((step, index) => (
          <motion.li
            key={step.state}
            className="relative flex gap-3 pb-5 last:pb-0"
            aria-current={step.status === "current" ? "step" : undefined}
            aria-disabled={step.status === "upcoming" ? true : undefined}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: ENTER_DURATION, delay: index * STAGGER, ease: EASE_OUT_EXPO }}
          >
            <span
              aria-hidden="true"
              className={cn(
                "z-10 flex size-6 shrink-0 items-center justify-center border",
                DOT[step.status],
              )}
            >
              {step.status === "done" ? (
                <CheckIcon size={12} weight="bold" />
              ) : (
                <span
                  className={cn("size-1.5", step.status === "current" ? "bg-brand" : "bg-input")}
                />
              )}
            </span>

            <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
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
                {step.occurredAt !== undefined && (
                  <time
                    dateTime={isoAttr(step.occurredAt)}
                    className="text-xs text-subtle-foreground"
                  >
                    {formatDateTime(step.occurredAt)}
                  </time>
                )}
              </div>
              <p
                className={cn(
                  "text-xs",
                  step.status === "upcoming" ? "text-subtle-foreground" : "text-muted-foreground",
                )}
              >
                {step.detail}
              </p>
            </div>
          </motion.li>
        ))}

        {failed && (
          <motion.li
            className="relative flex gap-3 pt-5"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: ENTER_DURATION,
              delay: steps.length * STAGGER,
              ease: EASE_OUT_EXPO,
            }}
          >
            <span
              aria-hidden="true"
              className="z-10 flex size-6 shrink-0 items-center justify-center border border-destructive bg-destructive text-white"
            >
              <XIcon size={12} weight="bold" />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
              <span className="text-sm font-medium text-destructive">
                {STATE_COPY.FAILED.label}
              </span>
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <WarningIcon
                  size={14}
                  aria-hidden="true"
                  className="mt-px shrink-0 text-destructive"
                />
                {failureReason ?? STATE_COPY.FAILED.detail}
              </p>
            </div>
          </motion.li>
        )}
      </ol>
    </div>
  );
}

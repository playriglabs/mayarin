import { type QuoteView, REFRESH_SECONDS } from "../features/link/use-quote-estimate.ts";
import { useT } from "../i18n/index.tsx";
import { errorText, estimateRow } from "./ui.ts";

const RING_RADIUS = 8;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** A ring that drains as the next automatic update gets closer, with the refresh arrow inside. */
function CountdownRing({
  secondsLeft,
  spinning,
}: {
  readonly secondsLeft: number | null;
  readonly spinning: boolean;
}) {
  const left = secondsLeft === null ? 0 : secondsLeft / REFRESH_SECONDS;
  return (
    <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
      <svg
        viewBox="0 0 20 20"
        fill="none"
        className="absolute inset-0 -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx="10"
          cy="10"
          r={RING_RADIUS}
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="1.5"
        />
        <circle
          cx="10"
          cy="10"
          r={RING_RADIUS}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - left)}
          className="transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
      </svg>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={`size-2.5 ${spinning ? "motion-safe:animate-spin" : ""}`}
      >
        <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" />
      </svg>
    </span>
  );
}

/**
 * "Estimated total in USDC … 3.50", and under it how fresh that figure is:
 * a countdown to the next automatic update that is also the button to update now.
 */
export function EstimateRow({
  asset,
  quote,
}: {
  readonly asset: string;
  readonly quote: QuoteView;
}) {
  const t = useT();
  const { estimate, secondsLeft, refreshing, refresh } = quote;
  const display = {
    idle: t("enterAnAmount"),
    loading: t("calculating"),
    unavailable: t("unavailable"),
    available: estimate.display,
  }[estimate.status];
  const canRefresh = estimate.status === "available" || estimate.status === "unavailable";

  return (
    <>
      <div className={estimateRow} aria-busy={estimate.status === "loading"} aria-live="polite">
        <span>{t("estimatedTotalIn", { asset })}</span>
        {/* The placeholder is a prompt, not a figure, so it does not take the
            size of the total it stands in for. */}
        <strong className={estimate.status === "idle" ? "text-base! text-muted" : undefined}>
          {display}
        </strong>
      </div>
      {estimate.status === "unavailable" && (
        <p className={errorText} role="alert">
          {estimate.code === "request-failed" ? t("quoteRequestFailed") : t("quoteUnavailable")}
        </p>
      )}
      {canRefresh && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            aria-label={
              estimate.status === "available"
                ? t("refreshPriceAuto", { seconds: secondsLeft })
                : t("refreshPrice")
            }
            className="inline-flex items-center gap-2 rounded-full border border-line py-1.5 pr-3.5 pl-2 text-xs text-muted tabular-nums transition-colors enabled:hover:border-muted enabled:hover:text-ink disabled:cursor-default"
          >
            <CountdownRing
              secondsLeft={estimate.status === "available" ? secondsLeft : null}
              spinning={refreshing}
            />
            {estimate.status === "available" ? `${refreshing ? 0 : secondsLeft}s` : t("retry")}
          </button>
        </div>
      )}
    </>
  );
}

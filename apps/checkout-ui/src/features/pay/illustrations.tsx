/**
 * The pictures for the states a payer waits in or ends on.
 *
 * Drawn in code rather than shipped as images: they take the page's own colour
 * tokens, so they sit right in both themes, and the motion (the orbit, the
 * drawn check) is CSS a reduced-motion setting can switch off. Decorative —
 * every one is `aria-hidden`, because the heading beside it says the same thing
 * in words. The keyframes live in `styles.css`.
 */

import { AssetLogo } from "../../shared/asset-logo.tsx";

const ART = "block size-44 overflow-visible sm:size-52";
const TWINKLE =
  "origin-center [transform-box:fill-box] animate-[art-twinkle_2.2s_ease-in-out_infinite] motion-reduce:animate-none";
const DELAY = "[animation-delay:1.1s]";

/**
 * Money on its way: the asset the payer sent, ringed by an arc that turns and
 * a soft pulse. Quiet on purpose — the payer has nothing left to do here.
 */
export function ProcessingArt({ asset }: { readonly asset: string }) {
  return (
    <div className="relative grid size-40 place-items-center" aria-hidden="true">
      <span className="absolute inset-6 rounded-full bg-brand/15 motion-safe:animate-ping" />
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" aria-hidden="true">
        <circle cx="50" cy="50" r="46" strokeWidth="2" className="fill-none stroke-line" />
        <circle
          cx="50"
          cy="50"
          r="46"
          pathLength="100"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="22 78"
          className="origin-center fill-none stroke-brand [transform-box:fill-box] motion-safe:animate-spin [animation-duration:1.4s]"
        />
      </svg>
      <span className="relative grid size-24 place-items-center rounded-full bg-panel">
        <AssetLogo symbol={asset} size={64} />
      </span>
    </div>
  );
}

/** Done: a drawn check with a few sparks around it. */
export function SuccessArt() {
  return (
    <svg className={ART} viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="72" className="fill-brand/10" />
      <circle cx="100" cy="100" r="50" className="fill-brand" />
      <path
        d="M78 101 l15 15 l30 -32"
        pathLength="100"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="100"
        strokeDashoffset="100"
        className="fill-none stroke-panel animate-[art-draw_0.6s_0.15s_cubic-bezier(0.65,0,0.35,1)_forwards] motion-reduce:animate-none motion-reduce:[stroke-dashoffset:0]"
      />

      <path
        d="M44 56 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4 z"
        className="fill-electric"
      />
      <path
        d="M158 44 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 z"
        className={`fill-brand ${TWINKLE} ${DELAY}`}
      />
      <path
        d="M160 146 l3.5 8 l8 3.5 l-8 3.5 l-3.5 8 l-3.5 -8 l-8 -3.5 l8 -3.5 z"
        className={`fill-electric ${TWINKLE}`}
      />
      <circle cx="46" cy="140" r="4" className={`fill-brand ${TWINKLE} ${DELAY}`} />
      <circle cx="124" cy="34" r="3" className="fill-brand" />
    </svg>
  );
}

/** Failed: a cross in the danger colour, no celebration. */
export function FailedArt() {
  return (
    <svg className={ART} viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="72" className="fill-danger/10" />
      <circle cx="100" cy="100" r="50" className="fill-danger" />
      <path
        d="M84 84 l32 32 M116 84 l-32 32"
        strokeWidth="9"
        strokeLinecap="round"
        className="fill-none stroke-panel"
      />
    </svg>
  );
}

/** Expired: a clock whose time ran out. */
export function ExpiredArt() {
  return (
    <svg className={ART} viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="72" className="fill-danger/10" />
      <circle cx="100" cy="100" r="50" strokeWidth="6" className="fill-none stroke-danger" />
      <path
        d="M100 72 V100 L118 112"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="fill-none stroke-danger"
      />
      <circle cx="100" cy="100" r="4" className="fill-danger" />
    </svg>
  );
}

/**
 * The pictures for the states a payer waits in or ends on.
 *
 * Drawn in code rather than shipped as images: they take the page's own colour
 * tokens, so they sit right in both themes, and the motion (the orbit, the
 * drawn check) is CSS a reduced-motion setting can switch off. Decorative —
 * every one is `aria-hidden`, because the heading beside it says the same thing
 * in words.
 */

/** Money on its way: a card inside an orbit, with the payer's coin dropping in. */
export function ProcessingArt() {
  return (
    <svg className="state-art" viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="86" className="art-track" />
      <circle cx="100" cy="100" r="86" className="art-orbit" pathLength="100" />

      <g className="art-float">
        <rect x="52" y="84" width="96" height="60" rx="12" className="art-card" />
        <rect x="52" y="98" width="96" height="10" className="art-card-stripe" />
        <rect x="64" y="118" width="22" height="14" rx="3" className="art-chip" />
        <rect x="96" y="124" width="38" height="4" rx="2" className="art-card-line" />
      </g>

      <g className="art-coin">
        <circle cx="132" cy="64" r="18" className="art-coin-face" />
        <circle cx="132" cy="64" r="12" className="art-coin-ring" />
        <path d="M132 57 v14 M127 61 h10" className="art-coin-mark" />
      </g>

      <circle cx="58" cy="60" r="4" className="art-dot art-twinkle" />
      <circle cx="152" cy="150" r="3" className="art-dot art-twinkle art-delay" />
    </svg>
  );
}

/** Done: a drawn check with a few sparks around it. */
export function SuccessArt() {
  return (
    <svg className="state-art" viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="72" className="art-glow" />
      <circle cx="100" cy="100" r="50" className="art-success-disc" />
      <path d="M78 101 l15 15 l30 -32" className="art-check" pathLength="100" />

      <path d="M44 56 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4 z" className="art-spark" />
      <path
        d="M158 44 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 z"
        className="art-spark-brand art-twinkle art-delay"
      />
      <path
        d="M160 146 l3.5 8 l8 3.5 l-8 3.5 l-3.5 8 l-3.5 -8 l-8 -3.5 l8 -3.5 z"
        className="art-spark art-twinkle"
      />
      <circle cx="46" cy="140" r="4" className="art-dot art-twinkle art-delay" />
      <circle cx="124" cy="34" r="3" className="art-dot" />
    </svg>
  );
}

/** Failed: a cross in the danger colour, no celebration. */
export function FailedArt() {
  return (
    <svg className="state-art" viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="72" className="art-bad-glow" />
      <circle cx="100" cy="100" r="50" className="art-bad-disc" />
      <path d="M84 84 l32 32 M116 84 l-32 32" className="art-cross" />
    </svg>
  );
}

/** Expired: a clock whose time ran out. */
export function ExpiredArt() {
  return (
    <svg className="state-art" viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="72" className="art-bad-glow" />
      <circle cx="100" cy="100" r="50" className="art-clock" />
      <path d="M100 72 V100 L118 112" className="art-clock-hands" />
      <circle cx="100" cy="100" r="4" className="art-clock-pin" />
    </svg>
  );
}

/**
 * The Parahyangan Supply identity.
 *
 * The mark is Tangkuban Perahu — the mountain over Bandung whose silhouette
 * is an upturned boat — reduced to two shapes: the inverted hull over the
 * ridge line. Inline SVG so the logo ships with the page and recolors with
 * `currentColor`.
 */

export function LogoMark({ size = 36 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" role="img">
      <circle cx="24" cy="24" r="23" stroke="currentColor" strokeWidth="2" />
      {/* The upturned hull */}
      <path d="M12 20 L36 20 L30 27 L18 27 Z" fill="currentColor" />
      {/* The ridge it rests on */}
      <path
        d="M8 34 L17 29 L24 33 L31 29 L40 34"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LogoLockup() {
  return (
    <span className="inline-flex items-center gap-3">
      <LogoMark />
      <span className="flex flex-col font-display text-lg leading-none font-semibold tracking-wide">
        Parahyangan
        <small className="font-sans mt-1 text-[0.6875rem] font-semibold tracking-[0.32em] text-ink-soft uppercase">
          Supply
        </small>
      </span>
    </span>
  );
}

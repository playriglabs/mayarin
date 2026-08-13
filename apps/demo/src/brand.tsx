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
    <span className="lockup">
      <LogoMark />
      <span className="wordmark">
        Parahyangan
        <small>Supply</small>
      </span>
    </span>
  );
}

/**
 * The hero panel: the mountain at dusk over the city grid, in the brand
 * duotone. Decorative — the copy beside it carries the message.
 */
export function HeroArt() {
  return (
    <svg viewBox="0 0 480 400" fill="none" aria-hidden="true" className="hero-art">
      <rect width="480" height="400" fill="var(--color-tile)" />
      {/* Sun */}
      <circle cx="330" cy="120" r="58" fill="var(--color-accent)" />
      {/* Far ridge */}
      <path
        d="M0 258 L96 196 L176 244 L268 178 L364 238 L480 190 L480 400 L0 400 Z"
        fill="#3f3f46"
      />
      {/* The upturned hull, resting on the near ridge */}
      <path d="M148 210 L332 210 L296 252 L184 252 Z" fill="var(--color-foreground)" />
      {/* Near ridge */}
      <path
        d="M0 316 L120 268 L240 308 L368 262 L480 310 L480 400 L0 400 Z"
        fill="var(--color-foreground)"
      />
      {/* City grid lights */}
      <g fill="var(--color-background)" opacity="0.75">
        <rect x="60" y="336" width="8" height="8" />
        <rect x="120" y="352" width="8" height="8" />
        <rect x="182" y="334" width="8" height="8" />
        <rect x="248" y="356" width="8" height="8" />
        <rect x="310" y="338" width="8" height="8" />
        <rect x="376" y="352" width="8" height="8" />
        <rect x="428" y="336" width="8" height="8" />
      </g>
    </svg>
  );
}

/**
 * The tick that says settled.
 *
 * A status word alone is read at the same speed as every other word on the
 * document; a mark is read before any of them. Inline SVG rather than an icon
 * font or an image, because this has to survive a print with images disabled —
 * it is the one glyph on the page a filed invoice is filed for.
 *
 * `currentColor` so it takes the badge's tone, and `aria-hidden` because the
 * word beside it already says the same thing.
 */
export function PaidMark({ size = 14 }: { readonly size?: number }) {
  return (
    <svg
      className="paid-mark"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M5.25 8.25 7 10l3.75-4" />
    </svg>
  );
}

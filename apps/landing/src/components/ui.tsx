import type { JSX } from "preact";

/**
 * The one primitive shared across pages. `Section`, `Label`, `SectionHeading`,
 * `Lede`, `Button` and `Rule` lived here for the previous landing page and went
 * with it — the current one builds its rhythm in `components/landing/ui.tsx`.
 */
export function ArrowRight(props: JSX.SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      width="14"
      height="14"
      stroke="currentColor"
      stroke-width="1.5"
      {...props}
    >
      <path d="M2.5 8h11M9 3.5 13.5 8 9 12.5" stroke-linecap="square" />
    </svg>
  );
}

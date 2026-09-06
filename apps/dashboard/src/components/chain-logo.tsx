import { chainLabel, chainLogoUrl } from "@mayarin/chain";
import type * as React from "react";
import { cn } from "@/lib/utils";

function ChainLogo({
  chain,
  size = 22,
  className,
  style,
}: {
  readonly chain: string;
  readonly size?: number;
  readonly className?: string;
  /** Pins an exact pixel size, for a caller not sizing from the surrounding text. */
  readonly style?: React.CSSProperties;
}) {
  const source = chainLogoUrl(chain);
  if (source === undefined) return null;
  return (
    <img
      src={source}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      decoding="async"
      {...(style === undefined ? {} : { style })}
      // Sized in `em` rather than at `size` so the mark tracks whatever text it
      // sits in: the same label appears standalone in a table row and inline
      // inside `text-xs` prose, where a fixed 18px mark is taller than the line
      // box. `width`/`height` stay as the intrinsic hint against layout shift.
      className={cn("size-[1.15em] shrink-0 rounded-full object-contain", className)}
    />
  );
}

function ChainLabel({
  chain,
  size = 22,
  className,
}: {
  readonly chain: string;
  readonly size?: number;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        // `align-middle` puts an inline box's centre on the baseline plus half
        // an x-height, which sits high for a mark taller than the text; the
        // negative offset drops it back onto the sentence. The gap is `em` for
        // the same reason as the mark's size, and a chain never wraps away
        // from its own logo.
        "inline-flex items-center gap-[0.35em] whitespace-nowrap align-[-0.25em]",
        className,
      )}
    >
      <ChainLogo chain={chain} size={size} />
      <span>{chainLabel(chain)}</span>
    </span>
  );
}

/**
 * Networks as overlapping marks, with no names.
 *
 * For a figure that is the sum of several chains: the stack says "more than one
 * network is behind this number" in the width of two icons, where a list of
 * labels would take the whole cell and repeat what the balances page already
 * says in full. Each mark carries a ring in the surface colour, so they read as
 * distinct discs while touching — the overlap is what makes them one group
 * rather than a row of separate things.
 *
 * A chain with no mark of its own renders nothing, so the stack silently
 * narrows rather than leaving a hole where a logo should be.
 */
function ChainStack({
  chains,
  size = 20,
  className,
}: {
  readonly chains: readonly string[];
  readonly size?: number;
  readonly className?: string;
}) {
  const marks = chains.filter((chain) => chainLogoUrl(chain) !== undefined);
  if (marks.length === 0) return null;
  return (
    <span className={cn("flex items-center", className)} aria-hidden="true">
      {marks.map((chain, index) => (
        <ChainLogo
          key={chain}
          chain={chain}
          size={size}
          // `rounded-[50%]`, not `rounded-full`: this app sets `--radius-full`
          // to 0 along with the rest of the scale, so every `rounded-full` in
          // it is square. A mark that is round in its own artwork (Arc) then
          // sits beside one that is not (Base's is a square PNG), and the
          // stack reads as broken. A literal value bypasses the token.
          //
          // Later marks overlap earlier ones and sit on top, which is the
          // direction the eye already reads. The ring is the card's own
          // colour, so the discs separate without a gap between them.
          className={cn("rounded-[50%] ring-2 ring-card", index > 0 && "-ml-2")}
          style={{ width: size, height: size }}
        />
      ))}
    </span>
  );
}

export { ChainLabel, ChainLogo, ChainStack };

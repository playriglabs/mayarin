import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

/**
 * Uppercase and operators — lowercase reads as a typo rather than as noise. W
 * and M are left out: they are the widest glyphs in the face, and the label is
 * held on one line, so keeping the run narrow keeps it inside its cell.
 */
const GLYPHS = "ABCDEFGHIJKLNOPQRSTUVXYZ0123456789/<>*+=-#";

/** Repaint at ~24fps. Every frame is too frantic to read as characters. */
const FRAME_MS = 42;

type ScrambleTextProps = {
  text: string;
  /** Milliseconds from the first glyph resolving to the last. */
  duration?: number;
  /**
   * CSS selector for an ancestor whose hover drives the scramble — used where
   * the whole card is the hit area. Without it the span listens to itself.
   */
  trigger?: string;
  class?: string;
};

function randomGlyph(): string {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? "#";
}

/**
 * Resolves the label out of noise on hover, left to right.
 *
 * Random glyphs are wider than the letters they stand in for, so the label is
 * pinned to a single line: the height never changes and nothing below it can
 * move. The width breathes a little, which the surrounding cell absorbs.
 */
export function ScrambleText({
  text,
  duration = 620,
  trigger,
  class: className = "",
}: ScrambleTextProps) {
  const [display, setDisplay] = useState(text);
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const frame = useRef(0);

  const scramble = useCallback(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    cancelAnimationFrame(frame.current);

    const chars = [...text];
    /* A rising ramp sweeps the resolve left to right; the jitter on top of it
       keeps the sweep from reading as one mechanical wipe. */
    const resolveAt = chars.map(
      (_, index) =>
        (index / Math.max(chars.length, 1)) * duration * 0.65 + Math.random() * duration * 0.35,
    );

    const start = performance.now();
    let lastPaint = Number.NEGATIVE_INFINITY;

    const tick = (now: number) => {
      const elapsed = now - start;

      if (elapsed >= duration) {
        setDisplay(text);
        return;
      }

      if (now - lastPaint >= FRAME_MS) {
        lastPaint = now;
        setDisplay(
          chars
            .map((char, index) =>
              char === " " || elapsed >= (resolveAt[index] ?? 0) ? char : randomGlyph(),
            )
            .join(""),
        );
      }

      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
  }, [text, duration]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const target = trigger ? host.closest(trigger) : host;
    if (!target) return;

    target.addEventListener("mouseenter", scramble);
    target.addEventListener("focusin", scramble);

    return () => {
      target.removeEventListener("mouseenter", scramble);
      target.removeEventListener("focusin", scramble);
      cancelAnimationFrame(frame.current);
    };
  }, [scramble, trigger]);

  return (
    <span ref={hostRef} class={clsx("inline-block whitespace-nowrap", className)}>
      {display}
    </span>
  );
}

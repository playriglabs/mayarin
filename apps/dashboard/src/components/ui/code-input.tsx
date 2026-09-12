import { useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * A one-time code, as one box per digit.
 *
 * Six boxes rather than one field, because the shape of the control tells the
 * reader what is wanted before they type: how many digits, how many are left,
 * and — with the boxes filled left to right — where they are. A single field
 * with letter-spacing only looks like that.
 *
 * ## What it has to survive
 *
 * Nobody types a code they read; they paste it, or their browser fills it. Both
 * arrive as six characters landing in one box, so `onChange` spreads anything
 * longer than a digit across the remaining boxes instead of truncating it. The
 * first box carries `autoComplete="one-time-code"`, which is what lets a browser
 * or an OS offer the code it just saw.
 *
 * Backspace in an empty box moves back and clears, rather than doing nothing —
 * the only way to correct a mistyped digit without reaching for the mouse.
 *
 * ## Accessibility
 *
 * Six inputs would otherwise be six unlabelled boxes. Each carries its position
 * as its accessible name, the group is labelled by the caller's own label
 * through `aria-labelledby`, and the caller's error id reaches every box so a
 * screen reader hears the failure wherever focus happens to be.
 */

export interface CodeInputProps {
  readonly id: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly length?: number;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  /** Submitted when the last digit lands, so a complete code needs no second action. */
  readonly onComplete?: (code: string) => void;
  readonly labelledBy?: string;
  readonly describedBy?: string;
}

const DIGITS_ONLY = /\D/g;

export function CodeInput({
  id,
  value,
  onChange,
  length = 6,
  disabled = false,
  invalid = false,
  onComplete,
  labelledBy,
  describedBy,
}: CodeInputProps) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, index) => value[index] ?? "");

  function focusBox(index: number) {
    const box = boxes.current[Math.max(0, Math.min(length - 1, index))];
    box?.focus();
    box?.select();
  }

  function commit(next: string, caret: number) {
    const trimmed = next.slice(0, length);
    onChange(trimmed);
    focusBox(caret);
    if (trimmed.length === length) onComplete?.(trimmed);
  }

  function onBoxChange(index: number, raw: string) {
    const typed = raw.replace(DIGITS_ONLY, "");
    if (typed === "") return;

    // One character is a keystroke; more is a paste or an autofill, and it
    // belongs across the boxes from here rather than crammed into this one.
    const characters = [...digits];
    for (const [offset, character] of [...typed].entries()) {
      const target = index + offset;
      if (target >= length) break;
      characters[target] = character;
    }
    commit(characters.join("").slice(0, length), index + typed.length);
  }

  function onKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace") {
      event.preventDefault();
      const characters = [...digits];
      // An empty box steps back and clears the one before it. A full box clears
      // itself and stays, so a single correction is one keystroke either way.
      const target = characters[index] === "" ? index - 1 : index;
      if (target < 0) return;
      characters[target] = "";
      commit(characters.join("").replace(/\s+$/, ""), target);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusBox(index - 1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusBox(index + 1);
    }
  }

  return (
    // A real `fieldset` rather than `role="group"`: the element already means
    // this. No `legend`, because the caller's own label names it through
    // `aria-labelledby` and a second visible heading would be a duplicate.
    <fieldset
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      className="m-0 flex min-w-0 items-center gap-2 border-0 p-0"
    >
      {digits.map((digit, index) => (
        <input
          // biome-ignore lint/suspicious/noArrayIndexKey: position IS the identity of a box — digits move between boxes on every edit, so the value cannot key the list, and the list never reorders.
          key={`${id}-${index}`}
          id={index === 0 ? id : `${id}-${index}`}
          ref={(element) => {
            boxes.current[index] = element;
          }}
          value={digit}
          onChange={(event) => onBoxChange(index, event.target.value)}
          onKeyDown={(event) => onKeyDown(index, event)}
          // Selects on focus so typing over a filled box replaces rather than
          // appends, which is what a second attempt at one digit expects.
          onFocus={(event) => event.currentTarget.select()}
          inputMode="numeric"
          // Not `type="number"`: a spinner, a scroll-wheel hazard, and a leading
          // zero that some browsers eat.
          type="text"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          // `maxLength` is the typing bound, not the paste bound — a paste
          // arrives in `onChange` whole and is spread before this applies.
          maxLength={length}
          aria-label={`Digit ${index + 1} of ${length}`}
          aria-invalid={invalid || undefined}
          className={cn(
            "h-16 w-full min-w-0 rounded-lg border border-input bg-card text-center",
            // An arbitrary size, not a scale token: `--text-*: initial` closes
            // this app's type scale at four sizes, so `text-3xl` and friends
            // compile to nothing and the digits silently stay at body size.
            // One oversized control does not earn a fifth shared token.
            "font-mono text-[28px] leading-none text-foreground tabular-nums caret-transparent",
            "transition-colors focus-visible:border-ring focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
            "disabled:bg-muted disabled:text-subtle-foreground",
            invalid && "border-destructive",
          )}
        />
      ))}
    </fieldset>
  );
}

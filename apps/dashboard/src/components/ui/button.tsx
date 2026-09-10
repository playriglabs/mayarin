import { cva, type VariantProps } from "class-variance-authority";
import { type HTMLMotionProps, motion } from "motion/react";
import { PRESS_SCALE, pressTransition } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Button.
 *
 * `default` is the filled ink button, matching shadcn's naming — it is NOT the
 * brand green. Green is reserved for focus and state, where it carries meaning
 * a filled button would dilute.
 *
 * Press feedback is a motion `whileTap` scale, not a CSS `:active` rule. That
 * keeps every timing in `lib/motion` and means `MotionProvider` can drop it for
 * a reader who asked for reduced motion — a CSS rule would not know to.
 *
 * `transition-colors` is the one CSS transition left in the app, and only
 * because the palette lives in Tailwind classes: moving hover colour into
 * motion would duplicate every variant's colours in JS and make a `className`
 * override silently lose to an inline style.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Ink that wipes to forest on hover — the landing's primary button.
        default: "bg-primary text-primary-foreground hover:bg-brand",
        secondary: "border border-input bg-card text-foreground hover:bg-muted",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        destructive: "border border-input bg-card text-destructive hover:bg-destructive-muted",
        link: "text-foreground underline decoration-input underline-offset-2 hover:decoration-foreground",
      },
      size: {
        default: "h-9 px-5",
        sm: "h-7 px-3 text-xs",
        icon: "size-7 px-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

/**
 * Motion's props are the source of truth here rather than the DOM's: it
 * redefines `style`, `onAnimationStart` and the drag handlers with its own
 * signatures, and `HTMLMotionProps` already includes every ordinary button
 * attribute a caller needs.
 */
type ButtonProps = HTMLMotionProps<"button"> & VariantProps<typeof buttonVariants>;

function Button({ className, variant, size, disabled, ...props }: ButtonProps) {
  return (
    <motion.button
      data-slot="button"
      disabled={disabled}
      // `whileTap` is omitted on a disabled button — it cannot be pressed, so
      // it must not appear to respond. Spread rather than passing `undefined`,
      // which `exactOptionalPropertyTypes` rejects.
      {...(disabled === true ? {} : { whileTap: { scale: PRESS_SCALE } })}
      transition={pressTransition}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };

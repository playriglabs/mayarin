/**
 * Motion configuration and the shared variants every animated surface uses.
 *
 * Motion owns ALL motion in this app. There is no CSS transition or `:active`
 * rule doing animation work — that was removed so timing lives in one file
 * instead of being split between a stylesheet and a component.
 *
 * `MotionProvider` sets `reducedMotion="user"`, which is the single place
 * reduced motion is handled. Motion then drops transform and scale animations
 * for a user who asked for that and keeps opacity, so a popup still fades in
 * and out — it simply does not travel or scale. Components do not need their
 * own `useReducedMotion` branch.
 *
 * Astro hydrates each island as its own React root, so a provider in the layout
 * cannot reach them. Every island that animates mounts this itself.
 */

import { MotionConfig, type Transition, type Variants } from "motion/react";
import type { ReactNode } from "react";

/** Matches `--ease-out-expo` in the stylesheet, so any CSS easing agrees. */
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

/**
 * The two knobs. Enter is slower than exit because a surface arriving should be
 * readable, and one leaving should get out of the way — but both are long
 * enough to read as a fade rather than a cut.
 */
export const ENTER_DURATION = 0.32;
export const EXIT_DURATION = 0.24;

/** Press feedback. Short, because it tracks a finger rather than narrating. */
export const PRESS_DURATION = 0.14;

/** How far a pressed control settles. Small enough to feel, not to notice. */
export const PRESS_SCALE = 0.97;

const enter: Transition = { duration: ENTER_DURATION, ease: EASE_OUT_EXPO };
const exit: Transition = { duration: EXIT_DURATION, ease: "easeOut" };

/** Shared by every pressable control, so they all settle at the same rate. */
export const pressTransition: Transition = { duration: PRESS_DURATION, ease: "easeOut" };

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** Backdrops: opacity only. A backdrop that moves draws attention to itself. */
export const overlayVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: enter },
  exit: { opacity: 0, transition: exit },
};

/**
 * Anchored popups — the select list. Safe to animate `y` and `scale` because
 * the positioner places the popup with `left`/`top`, not with `transform`.
 */
export const popupVariants: Variants = {
  initial: { opacity: 0, y: -6, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1, transition: enter },
  exit: { opacity: 0, y: -4, scale: 0.98, transition: exit },
};

/**
 * Centred popups — dialogs.
 *
 * The `-50%` offsets are carried HERE rather than as `-translate-x-1/2` utility
 * classes. Motion writes the whole `transform`, so a Tailwind translate class
 * on the same element is overwritten the moment a scale animates, and the
 * dialog jumps to the bottom-right corner.
 */
export const dialogVariants: Variants = {
  initial: { opacity: 0, x: "-50%", y: "-50%", scale: 0.97 },
  animate: { opacity: 1, x: "-50%", y: "-50%", scale: 1, transition: enter },
  exit: { opacity: 0, x: "-50%", y: "-50%", scale: 0.98, transition: exit },
};

/** Right-anchored drawers. The popup's top/right/bottom offsets do the layout. */
export const drawerVariants: Variants = {
  initial: { opacity: 0, x: "100%" },
  animate: { opacity: 1, x: 0, transition: enter },
  exit: { opacity: 0, x: "100%", transition: exit },
};

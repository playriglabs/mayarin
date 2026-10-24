import { useEffect, useRef } from "preact/hooks";
import { gsap, registerGsap } from "../../lib/gsap.ts";

/**
 * Loops a timeline from the moment the illustration first scrolls into view. The
 * prerendered markup is the finished state, so no JavaScript and reduced
 * motion both see the illustration complete; the timeline only animates
 * *from* elsewhere back to it.
 */
export function useEntryTimeline<T extends HTMLElement>(
  build: (timeline: gsap.core.Timeline) => void,
) {
  const root = useRef<T>(null);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    registerGsap();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const context = gsap.context(() => {
      build(
        gsap.timeline({
          defaults: { ease: "power2.out" },
          repeat: -1,
          repeatDelay: 2.5,
          scrollTrigger: { trigger: node, start: "top 80%", once: true },
        }),
      );
    }, node);
    return () => context.revert();
  }, []);
  return root;
}

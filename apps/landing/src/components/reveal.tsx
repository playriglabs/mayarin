import { type ComponentChildren, createElement } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { gsap, registerGsap } from "../lib/gsap.ts";

type RevealProps = {
  children: ComponentChildren;
  /** Milliseconds of stagger. */
  delay?: number;
  class?: string;
  as?: "div" | "section" | "li" | "span" | "article" | "p";
};

/**
 * GSAP fade-and-rise on first entry. ScrollTrigger tears itself down after the
 * reveal, so scrolling back never replays it. The prerendered element stays
 * visible until JavaScript enhances it, preserving a useful no-JS page.
 */
export function Reveal({ children, delay = 0, class: className = "", as = "div" }: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    registerGsap();

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      gsap.set(node, { clearProps: "all" });
      return;
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        node,
        { autoAlpha: 0, y: 28, clipPath: "inset(0 0 12% 0)" },
        {
          autoAlpha: 1,
          y: 0,
          clipPath: "inset(0 0 0% 0)",
          delay: delay / 1000,
          duration: 0.9,
          ease: "expo.out",
          clearProps: "transform,clipPath,willChange",
          scrollTrigger: {
            trigger: node,
            start: "top 88%",
            once: true,
          },
        },
      );
    }, node);

    return () => context.revert();
  }, [delay]);

  return createElement(
    as,
    {
      ref,
      class: className,
      "data-gsap-reveal": "",
    },
    children,
  );
}

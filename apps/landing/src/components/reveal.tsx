import { type ComponentChildren, createElement } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

type RevealProps = {
  children: ComponentChildren;
  /** Milliseconds of stagger. */
  delay?: number;
  class?: string;
  as?: "div" | "section" | "li" | "span" | "article" | "p";
};

/**
 * Fade-and-rise on first entry. The observer disconnects once the element has
 * been shown, so the animation never replays on scroll-back — which is what
 * keeps the page feeling calm rather than reactive.
 *
 * The hidden state lives behind `.js` in `styles.css`, so a page that never
 * runs the script still renders every section.
 */
export function Reveal({ children, delay = 0, class: className = "", as = "div" }: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || shown) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [shown]);

  return createElement(
    as,
    {
      ref,
      class: `reveal ${className}`,
      "data-in": shown ? "true" : "false",
      style: `--reveal-delay:${delay}ms`,
    },
    children,
  );
}

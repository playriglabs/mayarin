import { useEffect, useRef, useState } from "preact/hooks";

const WORD = "Mayarin.";

/**
 * The name at the size the name deserves. Letters rise from behind the top edge
 * one after another when the footer comes into view, and an accent rail draws
 * itself underneath once they have landed — the same rail language as the rest
 * of the page, used one last time as a full stop.
 */
export function FooterWordmark() {
  const ref = useRef<HTMLDivElement | null>(null);
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
      { threshold: 0.25 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [shown]);

  return (
    <div ref={ref} data-in={shown ? "true" : "false"} class="wordmark group">
      <a href="#top" aria-label="Mayarin — back to top" class="block">
        <span class="sr-only">Mayarin</span>
        <span
          aria-hidden="true"
          class="block pb-[0.06em] font-display text-[clamp(3.5rem,26vw,25.5rem)] text-center leading-[0.78] tracking-[-0.045em] text-ink"
        >
          {[...WORD].map((letter, index) => (
            <span
              // Position is the identity here: the same letter appears twice.
              key={`${letter}-${index}`}
              class="wordmark-letter"
              style={`--letter-index:${index}`}
            >
              {letter}
            </span>
          ))}
        </span>
      </a>
    </div>
  );
}

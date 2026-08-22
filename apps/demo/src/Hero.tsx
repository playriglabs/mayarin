import { useEffect, useMemo, useState } from "react";
import { CURRENCY } from "./ProductCard.tsx";
import type { DemoProduct } from "./types.ts";

/** One slide per category, capped, so the rotation stays visually distinct. */
function pickSlides(products: readonly DemoProduct[]): readonly DemoProduct[] {
  const byCategory = new Map<string, DemoProduct>();
  for (const product of products) {
    const category = product.metadata.category;
    if (category !== undefined && !byCategory.has(category)) {
      byCategory.set(category, product);
    }
  }
  return [...byCategory.values()].slice(0, 5);
}

const SLIDE_INTERVAL_MS = 6000;

/**
 * The full-bleed hero: product photography behind the brand statement.
 *
 * The headline is static — only the photo and the caption card rotate, so
 * the page keeps one stable `h1`. Autoplay pauses on hover and on focus,
 * and never starts when the visitor prefers reduced motion.
 */
export function Hero({
  products,
  onView,
}: {
  readonly products: readonly DemoProduct[];
  readonly onView: (product: DemoProduct) => void;
}) {
  const slides = useMemo(() => pickSlides(products), [products]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useMemo(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useEffect(() => {
    if (paused || reducedMotion || slides.length < 2) return;
    const timer = setInterval(
      () => setIndex((current) => (current + 1) % slides.length),
      SLIDE_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [paused, reducedMotion, slides.length]);

  const current = slides[index];
  const price = current?.prices.find((entry) => entry.asset === CURRENCY);

  return (
    <section
      className="hero"
      id="atas"
      aria-roledescription="carousel"
      aria-label="Featured products"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {slides.map((product, i) => (
        <div
          key={product.id}
          className={i === index ? "hero-slide current" : "hero-slide"}
          aria-hidden={i !== index}
        >
          <img
            src={product.metadata.image}
            alt=""
            loading={i === 0 ? "eager" : "lazy"}
            decoding="async"
          />
        </div>
      ))}
      <div className="hero-scrim" aria-hidden="true" />
      <div className="hero-inner">
        <div className="hero-copy">
          <p className="kicker">Independent label · Bandung</p>
          <h1>
            Small releases,
            <br />
            <em>made in Bandung.</em>
          </h1>
          <p className="lede">
            Indonesian textiles meet everyday streetwear. Every piece is cut, sewn, and finished
            locally in small batches that are never reproduced.
          </p>
          <a className="cta" href="#koleksi">
            Shop the collection
          </a>
        </div>
        {current !== undefined && (
          <div className="hero-caption">
            <p className="kicker">{current.metadata.category ?? "Featured"}</p>
            <p className="hero-caption-name">{current.name}</p>
            {price !== undefined && <p className="price">{price.display}</p>}
            <button type="button" className="hero-view" onClick={() => onView(current)}>
              View product
            </button>
            {slides.length > 1 && (
              <div className="hero-controls">
                <button
                  type="button"
                  className="hero-arrow"
                  aria-label="Previous product"
                  onClick={() => setIndex((index + slides.length - 1) % slides.length)}
                >
                  <ChevronIcon direction="left" />
                </button>
                <span className="hero-count" aria-live="polite">
                  {index + 1} / {slides.length}
                </span>
                <button
                  type="button"
                  className="hero-arrow"
                  aria-label="Next product"
                  onClick={() => setIndex((index + 1) % slides.length)}
                >
                  <ChevronIcon direction="right" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ChevronIcon({ direction }: { readonly direction: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d={direction === "left" ? "M10 3 L5 8 L10 13" : "M6 3 L11 8 L6 13"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

import clsx from "clsx";
import { animate, inView, stagger } from "motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { SLIDES, type Slide } from "./slides.tsx";

/*
 * The deck is a horizontal scroll-snap track: the browser pages between slides
 * on trackpad swipe and touch, and `scrollIntoView` lands a slide exactly. The
 * keyboard, a vertical-wheel-to-slide handler, the WAI-ARIA carousel roles,
 * and each slide's own reveal sit on top. Below `md` the track becomes a long
 * vertical page. Nothing here mounts Lenis — it lives in `App`.
 */

const CORE = SLIDES.filter((slide) => !slide.backup);
const TOTAL_SECONDS = CORE.reduce((sum, slide) => sum + (slide.seconds ?? 0), 0);
/** Minimum wheel delta that counts as "turn the page". */
const WHEEL_THRESHOLD = 24;
/** One page per wheel gesture: ignore further deltas for this long. */
const WHEEL_LOCK_MS = 700;
const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isPaged(): boolean {
  return window.matchMedia("(min-width: 48rem)").matches;
}

function indexFromHash(): number {
  const id = window.location.hash.slice(1);
  const index = SLIDES.findIndex((slide) => slide.id === id);
  return index === -1 ? 0 : index;
}

/** `**Lead.** rest` renders the lead in white; anything else renders as is. */
function Bullet({ text }: { text: string }) {
  if (!text.startsWith("**")) return <>{text}</>;
  const end = text.indexOf("**", 2);
  if (end === -1) return <>{text}</>;
  return (
    <>
      <strong class="font-medium text-white">{text.slice(2, end)}</strong>
      {text.slice(end + 2)}
    </>
  );
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Plays a slide's reveal once. What moves depends on what the slide is. */
function reveal(section: HTMLElement, slide: Slide) {
  if (reducedMotion()) return;

  if (slide.reveal.headline) {
    const headline = section.querySelector<HTMLElement>("[data-headline]");
    if (headline) {
      animate(headline, { opacity: [0, 1], x: [24, 0] }, { duration: 0.8, ease: EASE_OUT_EXPO });
    }
  }

  const visual = section.querySelector<HTMLElement>("[data-visual]");
  if (!visual) return;

  if (slide.reveal.visual === "fade") {
    animate(visual, { opacity: [0, 1] }, { duration: 0.9, ease: EASE_OUT_EXPO });
  } else if (slide.reveal.visual === "stagger") {
    const items = visual.querySelectorAll<HTMLElement>("[data-reveal]");
    if (items.length > 0) {
      animate(
        items,
        { opacity: [0, 1], x: [20, 0] },
        {
          delay: stagger(slide.reveal.stagger ?? 0.08, { startDelay: 0.15 }),
          duration: 0.55,
          ease: EASE_OUT_EXPO,
        },
      );
    }
  }
}

export function PitchDeck() {
  const [active, setActive] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);
  const track = useRef<HTMLElement | null>(null);
  const sections = useRef<(HTMLElement | null)[]>([]);
  const shown = useRef<Set<number>>(new Set());
  /** The slide the deck is on or heading to. Keys read this, not the scroll. */
  const activeRef = useRef(0);

  const goTo = useCallback((index: number, focus = true) => {
    const clamped = Math.max(0, Math.min(SLIDES.length - 1, index));
    const target = sections.current[clamped];
    if (!target) return;
    activeRef.current = clamped;
    setActive(clamped);
    target.scrollIntoView({
      behavior: reducedMotion() ? "auto" : "smooth",
      inline: "start",
      block: "start",
    });
    if (focus) target.focus({ preventScroll: true });
  }, []);

  // Document metadata and the root class that turns the page into a deck.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("deck");
    document.title = "Mayarin — Pitch";
    const robots = document.querySelector('meta[name="robots"]');
    const previousRobots = robots?.getAttribute("content") ?? null;
    robots?.setAttribute("content", "noindex, nofollow");
    return () => {
      root.classList.remove("deck");
      if (robots && previousRobots !== null) robots.setAttribute("content", previousRobots);
    };
  }, []);

  // Land on the slide the URL names, without animation.
  useEffect(() => {
    const start = indexFromHash();
    activeRef.current = start;
    setActive(start);
    if (start > 0) {
      sections.current[start]?.scrollIntoView({
        behavior: "auto",
        inline: "start",
        block: "start",
      });
    }
  }, []);

  // A slide that scrolls into view (by key, wheel, swipe, or touch) becomes
  // active, owns the hash, and plays its reveal once. The callback returns a
  // leave handler on purpose: without one, `inView` unobserves the slide after
  // its first entry, and going back would never update the hash again.
  useEffect(() => {
    const root = track.current;
    const stops = sections.current.map((section, index) => {
      if (!section) return () => {};
      return inView(
        section,
        () => {
          activeRef.current = index;
          setActive(index);
          const slide = SLIDES[index];
          if (!slide) return () => {};
          window.history.replaceState(null, "", `#${slide.id}`);
          if (!shown.current.has(index)) {
            shown.current.add(index);
            reveal(section, slide);
            section.dataset.shown = "true";
          }
          return () => {};
        },
        root ? { root, amount: 0.5 } : { amount: 0.5 },
      );
    });
    return () => {
      for (const stop of stops) stop();
    };
  }, []);

  // Keyboard: right and down next, left and up previous, Home/End jump, F and N toggle.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable]")
      ) {
        return;
      }
      const current = activeRef.current;
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
        case " ":
          event.preventDefault();
          goTo(current + 1);
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
          event.preventDefault();
          goTo(current - 1);
          break;
        case "Home":
          event.preventDefault();
          goTo(0);
          break;
        case "End":
          event.preventDefault();
          goTo(SLIDES.length - 1);
          break;
        case "f":
        case "F":
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen();
          break;
        case "n":
        case "N":
          setNotesOpen((open) => !open);
          break;
        case "Escape":
          setNotesOpen(false);
          break;
        default:
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo]);

  // A vertical mouse wheel turns one page per gesture. A horizontal gesture
  // (trackpad swipe) is left to the browser, which snaps it natively. Anything
  // that scrolls on its own — the claim ledger — keeps its wheel.
  useEffect(() => {
    const root = track.current;
    if (!root) return;
    let lockedUntil = 0;
    const onWheel = (event: WheelEvent) => {
      if (!isPaged()) return;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      if (event.target instanceof HTMLElement && event.target.closest("[data-scroll]")) return;
      event.preventDefault();
      const now = performance.now();
      if (now < lockedUntil || Math.abs(event.deltaY) < WHEEL_THRESHOLD) return;
      lockedUntil = now + WHEEL_LOCK_MS;
      goTo(activeRef.current + (event.deltaY > 0 ? 1 : -1), false);
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [goTo]);

  const current = SLIDES[active] ?? SLIDES[0];
  const counter = useMemo(() => {
    if (!current) return "";
    if (current.backup) return current.label.split(" — ")[0] ?? "Backup";
    const position = CORE.indexOf(current) + 1;
    return `${position.toString().padStart(2, "0")} / ${CORE.length.toString().padStart(2, "0")}`;
  }, [current]);

  return (
    <>
      <a
        href="#deck"
        class="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-60 focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:text-void"
      >
        Skip to the deck
      </a>

      <main
        id="deck"
        ref={track}
        aria-roledescription="carousel"
        aria-label="Mayarin pitch deck"
        class="deck-track"
      >
        {SLIDES.map((slide, index) => (
          <DeckSlide
            key={slide.id}
            slide={slide}
            index={index}
            sectionRef={(node) => {
              sections.current[index] = node;
            }}
          />
        ))}
      </main>

      <p class="sr-only" aria-live="polite" aria-atomic="true">
        {current ? `Slide ${counter}: ${current.title}` : ""}
      </p>

      <nav
        aria-label="Deck controls"
        class="deck-chrome fixed inset-x-0 bottom-0 z-50 border-t border-line-inverse bg-void/90 text-white backdrop-blur"
      >
        <div class="shell flex items-center justify-between gap-4 py-3">
          <a href="/" class="flex items-center gap-3" aria-label="Mayarin home">
            <img
              src="/brand-kit/mayarin-logo-white.png"
              alt=""
              width="28"
              height="28"
              class="size-7"
              decoding="async"
            />
            <span class="label hidden text-slate-inverse sm:inline">
              Pitch · {formatClock(TOTAL_SECONDS)} of 7:00
            </span>
          </a>

          <ol class="hidden items-center gap-2 md:flex" aria-label="Slides">
            {SLIDES.map((slide, index) => (
              <li
                key={slide.id}
                class={clsx(slide.backup && index > 0 && !SLIDES[index - 1]?.backup && "ml-3")}
              >
                <button
                  type="button"
                  onClick={() => goTo(index)}
                  aria-label={`${slide.backup ? "Backup: " : ""}${slide.title}`}
                  aria-current={index === active ? "true" : undefined}
                  class={clsx(
                    "block h-2 transition-[width,background-color] duration-300",
                    index === active
                      ? "w-6 bg-accent"
                      : "w-2 bg-line-inverse hover:bg-slate-inverse",
                    slide.backup && "rounded-full",
                  )}
                />
              </li>
            ))}
          </ol>

          <div class="flex items-center gap-3">
            <span class="font-mono text-xs text-slate-inverse" aria-hidden="true">
              {counter}
            </span>
            <button
              type="button"
              onClick={() => goTo(active - 1)}
              disabled={active === 0}
              aria-label="Previous slide"
              class="size-9 border border-line-inverse text-sm transition-colors hover:border-accent disabled:opacity-30 disabled:hover:border-line-inverse"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => goTo(active + 1)}
              disabled={active === SLIDES.length - 1}
              aria-label="Next slide"
              class="size-9 border border-line-inverse text-sm transition-colors hover:border-accent disabled:opacity-30 disabled:hover:border-line-inverse"
            >
              →
            </button>
            <button
              type="button"
              onClick={() => setNotesOpen((open) => !open)}
              aria-pressed={notesOpen}
              aria-controls="deck-notes"
              class="label hidden h-9 border border-line-inverse px-3 text-slate-inverse transition-colors hover:border-accent hover:text-white aria-pressed:border-accent aria-pressed:text-white md:inline-flex md:items-center"
            >
              Notes · N
            </button>
          </div>
        </div>
      </nav>

      <aside
        id="deck-notes"
        aria-label="Speaker notes"
        hidden={!notesOpen}
        class="deck-chrome fixed top-0 right-0 bottom-16 z-40 w-full max-w-md overflow-y-auto border-l border-line-inverse bg-void/95 p-6 text-white backdrop-blur md:p-8"
      >
        {current ? (
          <>
            <p class="label text-slate-inverse">{current.label}</p>
            {current.seconds ? (
              <p class="mt-1 font-mono text-xs text-accent">{formatClock(current.seconds)}</p>
            ) : null}
            <ul class="mt-5 flex flex-col gap-3 text-sm leading-relaxed text-slate-inverse">
              {current.notes.map((note) => (
                <li key={note} class="border-t border-line-inverse pt-3">
                  {note}
                </li>
              ))}
            </ul>
            <p class="label mt-8 leading-relaxed text-slate-inverse">
              Keys · ← → ↑ ↓ · Home End · F fullscreen · N notes · Esc
            </p>
          </>
        ) : null}
      </aside>
    </>
  );
}

type DeckSlideProps = {
  slide: Slide;
  index: number;
  sectionRef: (node: HTMLElement | null) => void;
};

function DeckSlide({ slide, index, sectionRef }: DeckSlideProps) {
  const position = `${index + 1} of ${SLIDES.length}`;
  const fullWidth = slide.bullets.length === 0;
  return (
    // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA carousel pattern — a slide is a group with aria-roledescription="slide", not a fieldset.
    <section
      id={slide.id}
      ref={sectionRef}
      role="group"
      aria-roledescription="slide"
      aria-label={`${position}: ${slide.title}`}
      tabIndex={-1}
      data-shown="false"
      data-reveal-visual={slide.reveal.visual}
      data-reveal-headline={slide.reveal.headline ? "true" : undefined}
      class="deck-slide relative grid content-center overflow-hidden bg-void text-white outline-none"
    >
      {slide.backdrop}
      <div
        class={clsx(
          "shell relative z-10 grid items-center gap-10 pt-20 pb-28 md:pt-24 md:pb-32 lg:gap-16",
          fullWidth ? "lg:grid-cols-1" : "lg:grid-cols-[1.1fr_1fr]",
        )}
      >
        <div class="flex flex-col gap-6 md:gap-8">
          <p class="label flex items-center gap-2.5 text-slate-inverse">
            <span aria-hidden="true" class="inline-block size-1.5 bg-accent" />
            {slide.label}
          </p>
          {index === 0 ? (
            <h1 data-headline class="text-[clamp(2.25rem,5vw,4.75rem)]">
              {slide.headline}
            </h1>
          ) : (
            <h2 data-headline class="text-[clamp(1.9rem,4.2vw,4rem)]">
              {slide.headline}
            </h2>
          )}
          {slide.bullets.length > 0 ? (
            <ul class="flex max-w-2xl flex-col gap-3 text-[clamp(0.95rem,1.3vw,1.2rem)] leading-relaxed text-slate-inverse">
              {slide.bullets.map((bullet) => (
                <li key={bullet} class="flex gap-3">
                  <span
                    aria-hidden="true"
                    class="mt-[0.8em] inline-block size-1 shrink-0 bg-accent"
                  />
                  <span>
                    <Bullet text={bullet} />
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div data-visual class="min-w-0">
          {slide.visual}
        </div>
      </div>
    </section>
  );
}

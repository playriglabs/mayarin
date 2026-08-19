import clsx from "clsx";
import { animate, inView, stagger } from "motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { SLIDES, type Slide } from "./slides.tsx";

/*
 * The deck is a scroll-snap document: the browser pages between slides on
 * wheel, trackpad, and touch, and `scrollIntoView` lands a slide exactly. The
 * keyboard, the WAI-ARIA carousel roles, and the staggered reveal sit on top.
 * Nothing here mounts Lenis — it lives in `App`, and it would fight the snap.
 */

const CORE = SLIDES.filter((slide) => !slide.backup);
const TOTAL_SECONDS = CORE.reduce((sum, slide) => sum + (slide.seconds ?? 0), 0);

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

export function PitchDeck() {
  const [active, setActive] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);
  const sections = useRef<(HTMLElement | null)[]>([]);
  const shown = useRef<Set<number>>(new Set());
  const activeRef = useRef(0);

  const goTo = useCallback((index: number, focus = true) => {
    const target = sections.current[Math.max(0, Math.min(SLIDES.length - 1, index))];
    if (!target) return;
    target.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
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
    if (start > 0) sections.current[start]?.scrollIntoView({ behavior: "auto", block: "start" });
  }, []);

  // Active slide, URL hash, and the one-time reveal — all from `inView`.
  useEffect(() => {
    const stops = sections.current.map((section, index) => {
      if (!section) return () => {};
      return inView(
        section,
        () => {
          activeRef.current = index;
          setActive(index);
          const slide = SLIDES[index];
          if (slide) window.history.replaceState(null, "", `#${slide.id}`);

          if (!shown.current.has(index)) {
            shown.current.add(index);
            const items = section.querySelectorAll<HTMLElement>("[data-reveal]");
            if (!reducedMotion() && items.length > 0) {
              animate(
                items,
                { opacity: [0, 1], y: [16, 0] },
                { delay: stagger(0.07), duration: 0.6, ease: [0.16, 1, 0.3, 1] },
              );
            }
            section.dataset.shown = "true";
          }
        },
        { amount: 0.6 },
      );
    });
    return () => {
      for (const stop of stops) stop();
    };
  }, []);

  // Keyboard: arrows and paging keys move one slide; Home/End jump; F and N toggle.
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

      <main id="deck" aria-roledescription="carousel" aria-label="Mayarin pitch deck">
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
              Keys · ← → · Home End · F fullscreen · N notes · Esc
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
      class="deck-slide relative grid min-h-dvh snap-start snap-always content-center bg-void text-white outline-none"
    >
      <div
        class={clsx(
          "shell grid items-center gap-10 pt-20 pb-28 md:pt-24 md:pb-32 lg:gap-16",
          fullWidth ? "lg:grid-cols-1" : "lg:grid-cols-[1.1fr_1fr]",
        )}
      >
        <div class="flex flex-col gap-6 md:gap-8">
          <p data-reveal class="label flex items-center gap-2.5 text-slate-inverse">
            <span aria-hidden="true" class="inline-block size-1.5 bg-accent" />
            {slide.label}
          </p>
          {index === 0 ? (
            <h1 data-reveal class="text-[clamp(2.25rem,5vw,4.75rem)]">
              {slide.headline}
            </h1>
          ) : (
            <h2 data-reveal class="text-[clamp(1.9rem,4.2vw,4rem)]">
              {slide.headline}
            </h2>
          )}
          {slide.bullets.length > 0 ? (
            <ul class="flex max-w-2xl flex-col gap-3 text-[clamp(0.95rem,1.3vw,1.2rem)] leading-relaxed text-slate-inverse">
              {slide.bullets.map((bullet) => (
                <li key={bullet} data-reveal class="flex gap-3">
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
        <div class="min-w-0">{slide.visual}</div>
      </div>
    </section>
  );
}

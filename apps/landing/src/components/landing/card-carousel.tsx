import clsx from "clsx";
import type { VNode } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { ArrowRight } from "../ui.tsx";

const GAP = 20;

function pagesOf<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";

/**
 * A page-at-a-time horizontal track: native scroll-snap for the motion, with a
 * mouse drag and arrow keys layered on, and a counter that reads the position
 * back out of `scrollLeft` rather than tracking it separately.
 *
 * Shared by every section that shows a long list a page at a time, so the
 * pointer capture and the keyboard handling exist once.
 */
export function CardCarousel<T>({
  id,
  ariaLabel,
  noun,
  items,
  pageSize,
  renderItem,
  class: className = "",
}: {
  readonly id: string;
  readonly ariaLabel: string;
  /** Plural, for the "1–4 / 12 use cases" counter. */
  readonly noun: string;
  readonly items: readonly T[];
  readonly pageSize: number;
  readonly renderItem: (item: T) => VNode;
  /** For placing the track in its section's grid. */
  readonly class?: string;
}) {
  const track = useRef<HTMLElement>(null);
  const [position, setPosition] = useState({ first: 0, atStart: true, atEnd: false });
  const pages = pagesOf(items, pageSize);

  const move = (direction: -1 | 1) => {
    const element = track.current;
    const card = element?.firstElementChild;
    if (!element || !(card instanceof HTMLElement)) return;
    element.scrollBy({
      left: direction * (card.getBoundingClientRect().width + GAP),
      behavior: scrollBehavior(),
    });
  };

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    let frame = 0;
    let drag: { readonly id: number; readonly x: number; readonly left: number } | undefined;

    const measure = () => {
      frame = 0;
      const card = element.firstElementChild;
      if (!(card instanceof HTMLElement)) return;
      const step = card.getBoundingClientRect().width + GAP;
      const first = Math.min(pages.length - 1, Math.max(0, Math.round(element.scrollLeft / step)));
      setPosition({
        first,
        atStart: element.scrollLeft <= 2,
        atEnd: element.scrollLeft >= element.scrollWidth - element.clientWidth - 2,
      });
    };
    const scheduleMeasure = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    const pointerDown = (event: PointerEvent) => {
      // Touch and trackpads use native scrolling; mouse users can drag the cards too.
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX, left: element.scrollLeft };
      element.setPointerCapture(event.pointerId);
      element.dataset.dragging = "true";
    };
    const pointerMove = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      element.scrollLeft = drag.left - (event.clientX - drag.x);
    };
    const pointerEnd = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      drag = undefined;
      delete element.dataset.dragging;
      if (element.hasPointerCapture(event.pointerId))
        element.releasePointerCapture(event.pointerId);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.target !== element) return;
      const card = element.firstElementChild;
      if (!(card instanceof HTMLElement)) return;
      const step = card.getBoundingClientRect().width + GAP;
      const left =
        event.key === "ArrowRight"
          ? element.scrollLeft + step
          : event.key === "ArrowLeft"
            ? element.scrollLeft - step
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? element.scrollWidth
                : undefined;
      if (left === undefined) return;
      event.preventDefault();
      element.scrollTo({ left, behavior: scrollBehavior() });
    };
    element.addEventListener("scroll", scheduleMeasure, { passive: true });
    element.addEventListener("pointerdown", pointerDown);
    element.addEventListener("pointermove", pointerMove);
    element.addEventListener("pointerup", pointerEnd);
    element.addEventListener("pointercancel", pointerEnd);
    element.addEventListener("lostpointercapture", pointerEnd);
    element.addEventListener("keydown", keyDown);
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(element);
    measure();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("scroll", scheduleMeasure);
      element.removeEventListener("pointerdown", pointerDown);
      element.removeEventListener("pointermove", pointerMove);
      element.removeEventListener("pointerup", pointerEnd);
      element.removeEventListener("pointercancel", pointerEnd);
      element.removeEventListener("lostpointercapture", pointerEnd);
      element.removeEventListener("keydown", keyDown);
    };
  }, [pages.length]);

  return (
    <div class={clsx("min-w-0 lg:pt-10", className)}>
      <section
        ref={track}
        id={id}
        aria-roledescription="carousel"
        aria-label={ariaLabel}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The scrollable carousel supports keyboard navigation.
        tabIndex={0}
        // Only the horizontal gesture belongs to the track. `data-lenis-prevent`
        // would hand Lenis back every gesture over it, so scrolling the page
        // past the carousel dropped out of the smoothed scroll and back into
        // the browser's own — two different scrolls on one page.
        data-lenis-prevent-horizontal
        class="flex snap-x snap-mandatory gap-5 overflow-x-auto overscroll-x-contain outline-offset-4 scrollbar-none [&::-webkit-scrollbar]:hidden cursor-grab select-none data-[dragging=true]:cursor-grabbing data-[dragging=true]:snap-none"
      >
        {pages.map((page, index) => (
          // biome-ignore lint/a11y/useSemanticElements: A carousel slide groups articles, not form controls.
          <div
            key={index}
            role="group"
            aria-roledescription="slide"
            aria-label={`${noun} ${index * pageSize + 1} to ${Math.min(items.length, (index + 1) * pageSize)}`}
            class="grid w-full shrink-0 snap-start grid-cols-1 gap-y-7 sm:grid-cols-2"
          >
            {page.map(renderItem)}
          </div>
        ))}
      </section>
      <div class="mt-7 flex items-center justify-between gap-5">
        <p class="text-xs text-slate-600" aria-live="polite" aria-atomic="true">
          {position.first * pageSize + 1}–{Math.min(items.length, (position.first + 1) * pageSize)}{" "}
          <span class="mx-1">/</span> {items.length} {noun}
        </p>
        <div class="flex gap-2">
          <button
            type="button"
            aria-label={`Previous ${noun}`}
            aria-controls={id}
            disabled={position.atStart}
            onClick={() => move(-1)}
            class="flex size-11 cursor-pointer items-center justify-center rounded-full border border-line transition-colors hover:border-forest hover:text-forest disabled:cursor-default disabled:opacity-30"
          >
            <ArrowRight class="size-4 rotate-180" />
          </button>
          <button
            type="button"
            aria-label={`Next ${noun}`}
            aria-controls={id}
            disabled={position.atEnd}
            onClick={() => move(1)}
            class="flex size-11 cursor-pointer items-center justify-center rounded-full border border-line transition-colors hover:border-forest hover:text-forest disabled:cursor-default disabled:opacity-30"
          >
            <ArrowRight class="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

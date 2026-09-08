import Lenis from "lenis";
import { gsap, registerGsap, ScrollTrigger } from "./gsap.ts";

/** Roughly the height of the fixed header, so anchors don't land underneath it. */
const HEADER_OFFSET = -88;

/**
 * Lenis drives the page scroll. In-page anchors are routed through it too —
 * otherwise a `#hash` link jumps instantly and the smoothing only applies to
 * wheel and touch, which reads as two different scrolls on one page.
 */
export function startSmoothScroll(): () => void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return () => {};
  }

  const lenis = new Lenis({
    duration: 1.05,
    easing: (t) => 1 - (1 - t) ** 3,
    smoothWheel: true,
  });
  registerGsap();

  const syncScrollTrigger = () => ScrollTrigger.update();
  const frame = (time: number) => lenis.raf(time * 1000);
  lenis.on("scroll", syncScrollTrigger);
  gsap.ticker.add(frame);

  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const target = event.target;
    if (!(target instanceof Element)) return;

    const anchor = target.closest("a");
    const href = anchor?.getAttribute("href");
    if (!href?.startsWith("#") || href === "#") return;

    const destination = document.querySelector(href);
    if (!destination) return;

    event.preventDefault();
    lenis.scrollTo(destination as HTMLElement, { offset: HEADER_OFFSET });
    window.history.replaceState(null, "", href);
  };

  document.addEventListener("click", onClick);

  return () => {
    document.removeEventListener("click", onClick);
    lenis.off("scroll", syncScrollTrigger);
    gsap.ticker.remove(frame);
    lenis.destroy();
  };
}

import Lenis from "lenis";
import { gsap, registerGsap, ScrollTrigger } from "./gsap.ts";

/** Roughly the height of the fixed header, so anchors don't land underneath it. */
const HEADER_OFFSET = -88;

/**
 * Anchor scrolls take longer the further they travel. One fixed duration felt
 * right for a header link to the next section and far too fast for a footer
 * link back to the top, which crossed the whole page — globe and all — in about
 * a second and stuttered on the way.
 */
function anchorDuration(distance: number): number {
  return Math.min(2.2, Math.max(0.9, 0.6 + distance / 3_000));
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

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
    if (!anchor?.href) return;

    // `#faq` and `/#faq` both point here when this is the landing page; the
    // footer uses the second so it still works from /brand-kit/.
    const url = new URL(anchor.href);
    if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return;
    if (url.hash === "" || url.hash === "#") return;

    const destination = document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (!destination) return;

    event.preventDefault();
    const distance = Math.abs(destination.getBoundingClientRect().top + HEADER_OFFSET);
    lenis.scrollTo(destination, {
      offset: HEADER_OFFSET,
      duration: anchorDuration(distance),
      easing: easeInOutCubic,
    });
    window.history.replaceState(null, "", url.hash);
  };

  document.addEventListener("click", onClick);

  return () => {
    document.removeEventListener("click", onClick);
    lenis.off("scroll", syncScrollTrigger);
    gsap.ticker.remove(frame);
    lenis.destroy();
  };
}

import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

/** Measure a stationary wrapper so the panel's transform cannot feed back into scroll progress. */
export function ScrollTilt({ children }: { readonly children: ComponentChildren }) {
  const container = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const anchor = container.current;
    const surface = panel.current;
    if (!anchor || !surface) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let previousTime = 0;
    let tilt = 1;

    const targetTilt = () => {
      if (reducedMotion.matches) return 0;
      const viewport = window.innerHeight;
      // Start at 90% of the viewport; finish flat when the panel reaches 25%.
      const progress = Math.min(
        1,
        Math.max(0, (viewport * 0.9 - anchor.getBoundingClientRect().top) / (viewport * 0.65)),
      );
      return 1 - progress * progress * (3 - 2 * progress);
    };

    const paint = () => surface.style.setProperty("--dashboard-tilt", tilt.toFixed(4));

    const animate = (time: number) => {
      frame = 0;
      const target = targetTilt();
      const elapsed = previousTime ? Math.min(time - previousTime, 64) : 16;
      previousTime = time;
      tilt += (target - tilt) * (1 - Math.exp(-elapsed / 100));
      if (Math.abs(target - tilt) < 0.0005) {
        tilt = target;
        previousTime = 0;
      } else {
        frame = window.requestAnimationFrame(animate);
      }
      paint();
    };

    const update = () => {
      if (reducedMotion.matches) {
        window.cancelAnimationFrame(frame);
        frame = 0;
        previousTime = 0;
        tilt = 0;
        paint();
      } else if (!frame) {
        frame = window.requestAnimationFrame(animate);
      }
    };

    // Respect restored scroll position on mount, without an initial animation from the top.
    tilt = targetTilt();
    paint();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    reducedMotion.addEventListener("change", update);
    const observer = new ResizeObserver(update);
    observer.observe(anchor);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      reducedMotion.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={container} class="relative z-10 [perspective:1600px]">
      <div
        ref={panel}
        class="origin-top [--dashboard-angle:18deg] [transform:rotateX(calc(var(--dashboard-angle)*var(--dashboard-tilt,1)))] motion-safe:will-change-transform motion-reduce:transform-none md:[--dashboard-angle:28deg]"
      >
        {children}
      </div>
    </div>
  );
}

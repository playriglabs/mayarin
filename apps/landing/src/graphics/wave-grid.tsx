import { useEffect, useRef } from "preact/hooks";

const COLS = 56;
const ROWS = 30;
/** Phones get a coarser mesh: same picture, a third of the path work. */
const COLS_NARROW = 30;
const ROWS_NARROW = 20;
/** Wave amplitude in pixels at the front edge of the plane. */
const AMPLITUDE = 34;
const SPEED = 0.00042;
/** How long the accent crest takes to travel from the horizon to the viewer. */
const SWEEP_MS = 9000;

type Projected = { x: number; y: number; lift: number };

/**
 * A grid plane in perspective with a wave running through it: the hero's
 * hairline grid, given depth and motion. Rows and columns are drawn as
 * polylines, so it reads as one surface rather than a field of dots.
 */
export function WaveGrid() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!window.matchMedia("(min-width: 768px)").matches) return;

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let cols = COLS;
    let rows = ROWS;
    let raf = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.lineWidth = 1;
      cols = width < 640 ? COLS_NARROW : COLS;
      rows = width < 640 ? ROWS_NARROW : ROWS;
    };

    /**
     * Depth runs 0 (horizon) to 1 (front). Everything — spread, height, wave
     * amplitude and line weight — is scaled by it, which is what sells the
     * plane as receding rather than flat.
     */
    const project = (u: number, v: number, time: number): Projected => {
      const depth = v ** 1.7;
      const horizon = height * 0.16;
      const spread = 0.28 + 0.92 * depth;

      const wave =
        Math.sin(u * 3.1 + time * 1.6) * 0.6 +
        Math.sin(u * 1.4 - v * 4.2 + time * 1.1) * 0.4 +
        Math.sin(v * 6.4 - time * 0.9) * 0.3;

      return {
        x: width / 2 + u * spread * width * 0.62,
        y: horizon + depth * (height - horizon) * 0.95 - wave * AMPLITUDE * depth,
        lift: wave,
      };
    };

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);

      const t = time * SPEED;
      const sweep = ((time % SWEEP_MS) / SWEEP_MS) ** 0.6;

      // Columns first: they read as the direction of travel.
      for (let column = 0; column <= cols; column += 1) {
        const u = (column / cols) * 2 - 1;
        context.beginPath();
        for (let row = 0; row <= rows; row += 1) {
          const point = project(u, row / rows, t);
          if (row === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        }
        context.strokeStyle = "rgba(17,17,17,0.085)";
        context.stroke();
      }

      for (let row = 0; row <= rows; row += 1) {
        const v = row / rows;
        const depth = v ** 1.7;

        context.beginPath();
        let crest = 0;
        for (let column = 0; column <= cols; column += 1) {
          const point = project((column / cols) * 2 - 1, v, t);
          crest = Math.max(crest, point.lift);
          if (column === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        }

        // Rows gain weight as they come forward, and a little more on a crest.
        const alpha = 0.06 + depth * 0.22 + Math.max(0, crest) * 0.06;
        const onSweep = Math.abs(v - sweep) < 0.022;
        context.strokeStyle = onSweep
          ? `rgba(14,235,46,${(0.32 + depth * 0.5).toFixed(3)})`
          : `rgba(17,17,17,${alpha.toFixed(3)})`;
        context.lineWidth = onSweep ? 1.4 : 1;
        context.stroke();
      }

      context.lineWidth = 1;
    };

    const loop = (time: number) => {
      draw(time);
      raf = window.requestAnimationFrame(loop);
    };

    resize();

    if (reduced) {
      draw(0);
    } else {
      raf = window.requestAnimationFrame(loop);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return (
    <div aria-hidden="true" class="pointer-events-none absolute inset-0 hidden md:block">
      <canvas ref={canvasRef} class="wave-canvas h-full w-full" />
    </div>
  );
}

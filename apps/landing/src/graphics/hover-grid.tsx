import { useEffect, useRef } from "preact/hooks";

const CELL = 76;
/** Phones never draw this, but a narrow desktop window gets a tighter mesh. */
const CELL_NARROW = 58;
/** How far the pointer's light reaches, in pixels. */
const RADIUS = 210;
/** The light trails the pointer instead of snapping to it. */
const POINTER_EASE = 0.16;
/** The drift crosses the grid at a wander, not at pointer speed. */
const AUTO_EASE = 0.028;
/** Fade in and out of the light as the pointer enters and leaves the hero. */
const STRENGTH_EASE = 0.1;

/** The drift is quieter than a real pointer, so it never competes with the copy. */
const AUTO_STRENGTH = 0.72;
/** How long the drift rests on a cell before picking the next one. */
const AUTO_DWELL_S = [1.4, 3] as const;
/** A hop shorter than this is not worth taking; the drift would look stuck. */
const AUTO_MIN_HOP = 260;
/** The drift stays in this band of the hero, out from under the headline. */
const AUTO_BAND = [0.12, 0.92] as const;
/** How long after the pointer leaves before the drift takes back over. */
const AUTO_RESUME_S = 1.1;

/** Cap a frame delta so a background tab does not teleport the drift. */
const MAX_DELTA_S = 0.064;

const ACCENT = "14,235,46";

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const amount = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return amount * amount * (3 - 2 * amount);
};

/**
 * The hero's grid. A light drifts across it on its own, cell by cell, and the
 * pointer takes the light over the moment it enters — the same effect, driven
 * by a real hand instead of the clock. It hands back a beat after the pointer
 * leaves. The loop stops whenever the hero is off screen or the light has
 * settled, so a hero nobody is looking at costs nothing.
 */
type HoverGridProps = Readonly<{
  /** "light" draws ink lines on paper; "dark" draws white lines on the void. */ tone?:
    | "light"
    | "dark";
}>;

export function HoverGrid({ tone = "light" }: HoverGridProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const base = tone === "dark" ? "255,255,255" : "17,17,17";
  // A white hairline on the void reads far weaker than an ink one on paper, so
  // the dark grid is drawn heavier to land at the same visual contrast.
  const gridAlpha = tone === "dark" ? 0.16 : 0.075;

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let cell = CELL;
    let raf = 0;
    let running = false;
    let last = 0;

    // Where the pointer is, where the light has caught up to, and how much of
    // it is showing.
    let targetX = 0;
    let targetY = 0;
    let lightX = 0;
    let lightY = 0;
    let strength = 0;
    let targetStrength = 0;

    /** The drift owns the light until a pointer shows up, and takes it back. */
    let auto = true;
    let autoDwell = 0;
    let resumeIn = 0;
    let onScreen = true;

    /** Grid lines land on half pixels so a 1px hairline stays a hairline. */
    const snap = (value: number) => Math.round(value) + 0.5;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      cell = width < 900 ? CELL_NARROW : CELL;
    };

    const drawGrid = () => {
      context.lineWidth = 1;
      context.strokeStyle = `rgba(${base},${gridAlpha})`;
      context.beginPath();
      for (let x = snap(0); x < width; x += cell) {
        context.moveTo(x, 0);
        context.lineTo(x, height);
      }
      for (let y = snap(0); y < height; y += cell) {
        context.moveTo(0, y);
        context.lineTo(width, y);
      }
      context.stroke();
    };

    const drawLight = () => {
      if (strength < 0.002) return;

      // Only the cells the light can actually reach are worth visiting.
      const first = Math.max(0, Math.floor((lightX - RADIUS) / cell));
      const lastColumn = Math.min(Math.ceil(width / cell), Math.ceil((lightX + RADIUS) / cell));
      const firstRow = Math.max(0, Math.floor((lightY - RADIUS) / cell));
      const lastRow = Math.min(Math.ceil(height / cell), Math.ceil((lightY + RADIUS) / cell));

      const hoveredColumn = Math.floor(lightX / cell);
      const hoveredRow = Math.floor(lightY / cell);

      context.lineWidth = 1;
      for (let row = firstRow; row < lastRow; row += 1) {
        for (let column = first; column < lastColumn; column += 1) {
          const x = snap(column * cell);
          const y = snap(row * cell);
          const dx = column * cell + cell / 2 - lightX;
          const dy = row * cell + cell / 2 - lightY;
          const reach = (1 - smoothstep(0, RADIUS, Math.hypot(dx, dy))) * strength;
          if (reach < 0.02) continue;

          context.fillStyle = `rgba(${ACCENT},${(reach * 0.07).toFixed(3)})`;
          context.fillRect(x, y, cell, cell);

          // The cell under the pointer reads as selected, not just lit.
          const hovered = column === hoveredColumn && row === hoveredRow;
          context.strokeStyle = `rgba(${ACCENT},${(reach * (hovered ? 0.75 : 0.34)).toFixed(3)})`;
          context.strokeRect(x, y, cell, cell);
        }
      }
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      drawGrid();
      drawLight();
    };

    const settled = () =>
      Math.abs(lightX - targetX) < 1.5 &&
      Math.abs(lightY - targetY) < 1.5 &&
      Math.abs(strength - targetStrength) < 0.002;

    /** Next cell for the drift: a real hop away, inside the band, on the grid. */
    const pickAutoTarget = () => {
      const [top, bottom] = AUTO_BAND;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const x = (Math.floor(Math.random() * (width / cell)) + 0.5) * cell;
        const y = top * height + Math.random() * (bottom - top) * height;
        if (Math.hypot(x - targetX, y - targetY) < AUTO_MIN_HOP && attempt < 11) continue;
        targetX = x;
        targetY = (Math.floor(y / cell) + 0.5) * cell;
        return;
      }
    };

    const advance = (delta: number) => {
      if (resumeIn > 0) {
        resumeIn -= delta;
        if (resumeIn <= 0) {
          auto = true;
          targetStrength = AUTO_STRENGTH;
          pickAutoTarget();
        }
      }

      if (auto) {
        autoDwell -= delta;
        if (autoDwell <= 0 && settled()) {
          autoDwell = AUTO_DWELL_S[0] + Math.random() * (AUTO_DWELL_S[1] - AUTO_DWELL_S[0]);
          pickAutoTarget();
        }
      }

      const ease = auto ? AUTO_EASE : POINTER_EASE;
      lightX += (targetX - lightX) * ease;
      lightY += (targetY - lightY) * ease;
      strength += (targetStrength - strength) * STRENGTH_EASE;
    };

    const loop = (time: number) => {
      const delta = last === 0 ? 0 : Math.min((time - last) / 1000, MAX_DELTA_S);
      last = time;
      advance(delta);
      draw();

      // A pointer-driven light that has caught up has nothing left to redraw;
      // the drift always does.
      if (!auto && resumeIn <= 0 && settled()) {
        running = false;
        return;
      }

      raf = window.requestAnimationFrame(loop);
    };

    const start = () => {
      if (running || reduced || !onScreen) return;
      running = true;
      last = 0;
      raf = window.requestAnimationFrame(loop);
    };

    const stop = () => {
      running = false;
      window.cancelAnimationFrame(raf);
    };

    // The canvas itself takes no pointer events — the copy and the buttons sit
    // over it — so the pointer is tracked on the window and mapped in.
    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;

      if (!inside) {
        if (!auto && resumeIn <= 0) resumeIn = AUTO_RESUME_S;
        start();
        return;
      }

      auto = false;
      resumeIn = 0;
      targetX = x;
      targetY = y;
      targetStrength = 1;
      start();
    };

    const onPointerLeave = () => {
      if (!auto && resumeIn <= 0) resumeIn = AUTO_RESUME_S;
      start();
    };

    resize();
    targetStrength = AUTO_STRENGTH;
    pickAutoTarget();
    lightX = targetX;
    lightY = targetY;
    draw();

    const observer = new ResizeObserver(() => {
      resize();
      draw();
    });
    observer.observe(canvas);

    // Off screen, the drift is a pure waste of frames.
    const visibility = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry?.isIntersecting ?? false;
        if (onScreen) start();
        else stop();
      },
      { rootMargin: "120px 0px" },
    );
    visibility.observe(canvas);

    if (!reduced) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      document.addEventListener("pointerleave", onPointerLeave);
      start();
    }

    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      visibility.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [base, gridAlpha]);

  return (
    <div aria-hidden="true" class="pointer-events-none absolute inset-0 block">
      <canvas ref={canvasRef} class="wave-canvas h-full w-full" />
    </div>
  );
}

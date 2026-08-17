import { useEffect, useRef } from "preact/hooks";

const CELL = 72;
const CELL_NARROW = 56;
const BEAM_COUNT = 6;
const POINTER_RADIUS = 190;
/** Cap a frame delta so a background tab does not teleport the beams. */
const MAX_DELTA_S = 0.064;

type Pointer = Readonly<{
  x: number;
  y: number;
  active: boolean;
}>;

type Beam = Readonly<{
  axis: "h" | "v";
  /** Index of the grid line the beam rides on. */
  line: number;
  /** Head position in pixels along the axis of travel. */
  head: number;
  dir: 1 | -1;
  speed: number;
  tail: number;
  accent: boolean;
}>;

const hash = (x: number, y: number) => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
};

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const amount = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return amount * amount * (3 - 2 * amount);
};

type GridFieldProps = Readonly<{
  /** "dark" draws white lines on the void; "light" draws ink lines on paper. */
  tone?: "dark" | "light";
}>;

/**
 * A patchy hairline grid: cell outlines thicken toward the bottom-right, and
 * light beams travel along the grid lines with a fading tail, like trains on
 * a rail map. Reduced motion draws the grid with no beams.
 */
export function GridField({ tone = "dark" }: GridFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const base = tone === "dark" ? "255,255,255" : "17,17,17";
  const fade = tone === "dark" ? "var(--color-void)" : "var(--color-paper)";

  useEffect(() => {
    if (!window.matchMedia("(min-width: 768px)").matches) return;

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let cell = CELL;
    let raf = 0;
    let running = false;
    let lastTime = 0;
    let beams: readonly Beam[] = [];
    let pointer: Pointer = { x: 0, y: 0, active: false };

    const spawnBeam = (): Beam => {
      const axis = Math.random() < 0.5 ? "h" : "v";
      const lineCount = Math.floor((axis === "h" ? height : width) / cell);
      const span = axis === "h" ? width : height;
      const dir = Math.random() < 0.5 ? 1 : -1;
      return {
        axis,
        line: 1 + Math.floor(Math.random() * Math.max(1, lineCount - 1)),
        head: dir === 1 ? -Math.random() * span : span + Math.random() * span,
        dir,
        speed: 90 + Math.random() * 170,
        tail: 90 + Math.random() * 150,
        accent: Math.random() < 0.7,
      };
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      cell = width < 640 ? CELL_NARROW : CELL;
      beams = Array.from({ length: BEAM_COUNT }, spawnBeam);
    };

    const drawGrid = () => {
      const columns = Math.ceil(width / cell);
      const rows = Math.ceil(height / cell);
      context.lineWidth = 1;

      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const grain = hash(column, row);
          const diagonal = (column / columns) * 0.95 + (row / rows) * 0.82;
          const density = smoothstep(0.15, 1.6, diagonal);
          const visible = grain <= density;

          let influence = 0;
          if (pointer.active) {
            const dx = column * cell + cell / 2 - pointer.x;
            const dy = row * cell + cell / 2 - pointer.y;
            influence = 1 - smoothstep(0, POINTER_RADIUS, Math.hypot(dx, dy));
          }

          if (!visible && influence < 0.02) continue;

          const x = column * cell + 0.5;
          const y = row * cell + 0.5;

          if (visible) {
            const alpha = 0.05 + grain * 0.06 + density * 0.03;
            context.strokeStyle = `rgba(${base},${alpha.toFixed(3)})`;
            context.strokeRect(x, y, cell, cell);
          }

          // The pointer lights nearby cells and reveals the hidden ones.
          if (influence >= 0.02) {
            context.fillStyle = `rgba(14,235,46,${(influence * 0.07).toFixed(3)})`;
            context.fillRect(x, y, cell, cell);
            context.strokeStyle = `rgba(14,235,46,${(influence * 0.4).toFixed(3)})`;
            context.strokeRect(x, y, cell, cell);
          }
        }
      }
    };

    const drawBeam = (beam: Beam) => {
      const color = beam.accent ? "14,235,46" : base;
      const track = beam.line * cell + 0.5;
      const tailEnd = beam.head - beam.dir * beam.tail;
      const gradient =
        beam.axis === "h"
          ? context.createLinearGradient(tailEnd, 0, beam.head, 0)
          : context.createLinearGradient(0, tailEnd, 0, beam.head);
      gradient.addColorStop(0, `rgba(${color},0)`);
      gradient.addColorStop(1, `rgba(${color},0.85)`);

      context.strokeStyle = gradient;
      context.lineWidth = 1.4;
      context.beginPath();
      if (beam.axis === "h") {
        context.moveTo(tailEnd, track);
        context.lineTo(beam.head, track);
      } else {
        context.moveTo(track, tailEnd);
        context.lineTo(track, beam.head);
      }
      context.stroke();

      // The head is a small square, matching the brand's pixel motif.
      const size = 4;
      context.fillStyle = `rgba(${color},0.95)`;
      if (beam.axis === "h") context.fillRect(beam.head - size / 2, track - size / 2, size, size);
      else context.fillRect(track - size / 2, beam.head - size / 2, size, size);
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      drawGrid();
      if (!reducedMotion) for (const beam of beams) drawBeam(beam);
    };

    const step = (deltaS: number) => {
      beams = beams.map((beam) => {
        const head = beam.head + beam.dir * beam.speed * deltaS;
        const span = beam.axis === "h" ? width : height;
        const gone = beam.dir === 1 ? head - beam.tail > span : head + beam.tail < 0;
        return gone ? spawnBeam() : { ...beam, head };
      });
    };

    const loop = (time: number) => {
      if (!running) return;
      const deltaS = Math.min(MAX_DELTA_S, (time - lastTime) / 1000);
      lastTime = time;
      step(deltaS);
      draw();
      raf = window.requestAnimationFrame(loop);
    };

    const setRunning = (next: boolean) => {
      if (reducedMotion || next === running) return;
      running = next;
      if (running) {
        lastTime = performance.now();
        raf = window.requestAnimationFrame(loop);
      } else {
        window.cancelAnimationFrame(raf);
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top, active: true };
      if (reducedMotion) draw();
    };

    const onPointerLeave = () => {
      pointer = { ...pointer, active: false };
      if (reducedMotion) draw();
    };

    resize();
    draw();

    const observer = new ResizeObserver(() => {
      resize();
      draw();
    });
    observer.observe(canvas);

    const visibilityObserver = new IntersectionObserver(
      ([entry]) => setRunning(entry?.isIntersecting ?? false),
      { rootMargin: "120px 0px" },
    );
    visibilityObserver.observe(canvas);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);

    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      visibilityObserver.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [base]);

  return (
    <div aria-hidden="true" class="absolute inset-y-0 right-0 hidden w-[72%] md:block">
      <div
        class="pointer-events-none absolute inset-0 z-1"
        style={{
          background: `linear-gradient(90deg, ${fade} 0%, transparent 38%, transparent 100%)`,
        }}
      />
      <canvas ref={canvasRef} class="h-full w-full touch-pan-y" />
    </div>
  );
}

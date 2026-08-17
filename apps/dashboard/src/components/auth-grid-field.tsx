import { useEffect, useRef } from "react";

const CELL = 64;
const BEAM_COUNT = 6;
const POINTER_RADIUS = 160;
/** Cap a frame delta so a background tab does not teleport the beams. */
const MAX_DELTA_S = 0.064;

type Pointer = Readonly<{ x: number; y: number; active: boolean }>;

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

const hash = (x: number, y: number): number => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
};

const smoothstep = (start: number, end: number, value: number): number => {
  const amount = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return amount * amount * (3 - 2 * amount);
};

/**
 * A patchy hairline grid behind the whole auth page, densest at the seam
 * between the two columns, with light beams that travel along the grid lines.
 * The pointer lights nearby cells. Reads the theme on every frame, so the
 * toggle restyles it live.
 */
export default function AuthGridField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let raf = 0;
    let lastTime = 0;
    let beams: readonly Beam[] = [];
    let pointer: Pointer = { x: 0, y: 0, active: false };

    const spawnBeam = (): Beam => {
      const axis = Math.random() < 0.5 ? "h" : "v";
      const lineCount = Math.floor((axis === "h" ? height : width) / CELL);
      const span = axis === "h" ? width : height;
      const dir = Math.random() < 0.5 ? 1 : -1;
      return {
        axis,
        line: 1 + Math.floor(Math.random() * Math.max(1, lineCount - 1)),
        head: dir === 1 ? -Math.random() * span : span + Math.random() * span,
        dir,
        speed: 70 + Math.random() * 130,
        tail: 70 + Math.random() * 110,
        accent: Math.random() < 0.7,
      };
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) return;

      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      beams = Array.from({ length: BEAM_COUNT }, spawnBeam);
    };

    const drawGrid = (base: string) => {
      const columns = Math.ceil(width / CELL);
      const rows = Math.ceil(height / CELL);
      context.lineWidth = 1;

      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const grain = hash(column, row);
          // The canvas spans the whole page. Keep the field densest at the seam
          // between the brand and form columns, and dissolve it toward the
          // tagline on the left and the form on the right.
          const fromSeam = Math.abs(column / columns - 0.46) * 2.4;
          const verticalGrain = (1 - row / rows) * 0.18;
          const density = smoothstep(0.1, 1.05, 1 - fromSeam + verticalGrain) * 0.9;
          const visible = grain <= density;

          let influence = 0;
          if (pointer.active) {
            const dx = column * CELL + CELL / 2 - pointer.x;
            const dy = row * CELL + CELL / 2 - pointer.y;
            influence = 1 - smoothstep(0, POINTER_RADIUS, Math.hypot(dx, dy));
          }

          if (!visible && influence < 0.02) continue;

          const x = column * CELL + 0.5;
          const y = row * CELL + 0.5;

          if (visible) {
            const alpha = 0.06 + grain * 0.07 + density * 0.04;
            context.strokeStyle = `rgba(${base},${alpha.toFixed(3)})`;
            context.strokeRect(x, y, CELL, CELL);
          }

          // The pointer lights nearby cells and reveals the hidden ones.
          if (influence >= 0.02) {
            context.fillStyle = `rgba(14,235,46,${(influence * 0.07).toFixed(3)})`;
            context.fillRect(x, y, CELL, CELL);
            context.strokeStyle = `rgba(14,235,46,${(influence * 0.4).toFixed(3)})`;
            context.strokeRect(x, y, CELL, CELL);
          }
        }
      }
    };

    const drawBeam = (beam: Beam, base: string) => {
      const color = beam.accent ? "14,235,46" : base;
      const track = beam.line * CELL + 0.5;
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
      const dark = document.documentElement.dataset.theme !== "light";
      const base = dark ? "250,250,250" : "17,17,17";
      drawGrid(base);
      if (!reducedMotion) for (const beam of beams) drawBeam(beam, base);
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
      const deltaS = Math.min(MAX_DELTA_S, (time - lastTime) / 1000);
      lastTime = time;
      step(deltaS);
      draw();
      raf = window.requestAnimationFrame(loop);
    };

    const onPointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top, active: true };
      if (reducedMotion) draw();
    };

    const onPointerLeave = () => {
      pointer = { ...pointer, active: false };
      if (reducedMotion) draw();
    };

    const observer = new ResizeObserver(() => {
      resize();
      if (reducedMotion) draw();
    });
    observer.observe(canvas);
    resize();
    draw();
    if (!reducedMotion) {
      lastTime = performance.now();
      raf = window.requestAnimationFrame(loop);
    }
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);

    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 size-full touch-pan-y" />;
}

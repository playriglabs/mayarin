import { useEffect, useRef } from "preact/hooks";

const CELL = 8;
const CELL_NARROW = 7;
const DENSITY_SCALE = 0.82;
const POINTER_RADIUS = 132;
const TAU = Math.PI * 2;

type Pointer = Readonly<{
  x: number;
  y: number;
  active: boolean;
}>;

type Pixel = Readonly<{
  x: number;
  y: number;
  size: number;
  grain: number;
}>;

const hash = (x: number, y: number) => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
};

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const amount = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return amount * amount * (3 - 2 * amount);
};

/**
 * A diagonal pixel scatter inspired by print halftones: dense checkerboard at
 * the bottom-right, dissolving into isolated squares toward the upper-left.
 * Points are generated only on resize; animation frames only draw them.
 */
export function PixelField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!window.matchMedia("(min-width: 768px)").matches) return;

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let raf = 0;
    let running = false;
    let pixels: readonly Pixel[] = [];
    let lastFrame = 0;
    let pointer: Pointer = { x: 0, y: 0, active: false };

    const buildPixels = () => {
      const cell = width < 640 ? CELL_NARROW : CELL;
      const columns = Math.ceil(width / cell);
      const rows = Math.ceil(height / cell);
      const nextPixels: Pixel[] = [];

      for (let row = 0; row <= rows; row += 1) {
        for (let column = 0; column <= columns; column += 1) {
          const x = column * cell + cell / 2;
          const y = row * cell + cell / 2;
          const grain = hash(column, row);
          const diagonal = (x / width) * 0.95 + (y / height) * 0.82;
          const density = smoothstep(0.38, 1.3, diagonal);
          const checker = (row + column) % 2 === 0;
          if (!checker || grain > density * DENSITY_SCALE) continue;

          nextPixels.push({ x, y, grain, size: 3.2 + density * 2.8 });
        }
      }

      pixels = nextPixels;
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
      buildPixels();
    };

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);

      const phase = reducedMotion ? 0 : time * 0.00032;

      for (const pixel of pixels) {
        let influence = 0;
        let direction = 0;
        if (pointer.active) {
          const dx = pixel.x - pointer.x;
          const dy = pixel.y - pointer.y;
          const pointerDistance = Math.sqrt(dx * dx + dy * dy);
          influence = 1 - smoothstep(0, POINTER_RADIUS, pointerDistance);
          direction = Math.atan2(dy, dx);
        }

        const displacement = influence * 17;
        const wave = reducedMotion
          ? 0
          : Math.sin(phase * 5 + pixel.x * 0.012 + pixel.y * 0.006 + pixel.grain * TAU);
        const driftX = wave * 1.25;
        const driftY = wave * 2.4;
        const drawX = pixel.x + Math.cos(direction) * displacement + driftX;
        const drawY = pixel.y + Math.sin(direction) * displacement + driftY;
        const size = pixel.size + influence * 4.6 + Math.max(0, wave) * 1.15;
        const alpha = Math.min(
          0.94,
          0.3 + pixel.grain * 0.3 + Math.max(0, wave) * 0.18 + influence * 0.48,
        );

        context.fillStyle =
          influence > 0.08
            ? `rgba(14,235,46,${alpha.toFixed(3)})`
            : `rgba(255,255,255,${alpha.toFixed(3)})`;
        context.fillRect(drawX - size / 2, drawY - size / 2, size, size);
      }

      const gradient = context.createRadialGradient(
        pointer.x,
        pointer.y,
        0,
        pointer.x,
        pointer.y,
        POINTER_RADIUS,
      );
      gradient.addColorStop(0, "rgba(14,235,46,0.08)");
      gradient.addColorStop(1, "rgba(14,235,46,0)");
      context.fillStyle = pointer.active ? gradient : "transparent";
      context.fillRect(0, 0, width, height);
    };

    const loop = (time: number) => {
      if (!running) return;
      if (time - lastFrame >= 1000 / 30) {
        draw(time);
        lastFrame = time;
      }
      raf = window.requestAnimationFrame(loop);
    };

    const setRunning = (next: boolean) => {
      if (reducedMotion || next === running) return;
      running = next;
      if (running) raf = window.requestAnimationFrame(loop);
      else window.cancelAnimationFrame(raf);
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top, active: true };
      if (reducedMotion) draw(0);
    };

    const onPointerLeave = () => {
      pointer = { ...pointer, active: false };
      if (reducedMotion) draw(0);
    };

    resize();
    draw(0);

    const observer = new ResizeObserver(() => {
      resize();
      if (reducedMotion) draw(0);
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
  }, []);

  return (
    <div aria-hidden="true" class="absolute inset-y-0 right-0 hidden w-[72%] md:block">
      <div class="pointer-events-none absolute inset-0 z-1 bg-[linear-gradient(90deg,var(--color-void)_0%,transparent_38%,transparent_100%)]" />
      <canvas ref={canvasRef} class="h-full w-full touch-pan-y" />
    </div>
  );
}

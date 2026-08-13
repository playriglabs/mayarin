import { useEffect, useRef } from "react";

const CELL = 8;

type Pixel = Readonly<{ x: number; y: number; size: number; grain: number }>;

const hash = (x: number, y: number): number => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
};

const smoothstep = (start: number, end: number, value: number): number => {
  const amount = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return amount * amount * (3 - 2 * amount);
};

export default function AuthPixelField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let frame = 0;
    let pixels: readonly Pixel[] = [];

    const buildPixels = () => {
      const columns = Math.ceil(width / CELL);
      const rows = Math.ceil(height / CELL);
      const next: Pixel[] = [];

      for (let row = 0; row <= rows; row += 1) {
        for (let column = 0; column <= columns; column += 1) {
          const x = column * CELL + CELL / 2;
          const y = row * CELL + CELL / 2;
          const grain = hash(column, row);
          // Keep the field concentrated on the right, then dissolve it before
          // it competes with the brand and tagline on the left.
          const fromRight = x / width;
          const verticalGrain = (1 - y / height) * 0.24;
          const density = smoothstep(0.38, 1.1, fromRight + verticalGrain) * 0.88;
          if ((row + column) % 2 !== 0 || grain > density) continue;
          next.push({ x, y, grain, size: 2.5 + density * 2 });
        }
      }
      pixels = next;
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      buildPixels();
    };

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);
      const dark = document.documentElement.dataset.theme !== "light";
      const base = dark ? "250,250,250" : "17,17,17";

      for (const pixel of pixels) {
        const drift = reducedMotion
          ? 0
          : Math.sin(time * 0.0012 + pixel.x * 0.012 + pixel.y * 0.008 + pixel.grain * 6.28);
        const alpha = Math.min(0.76, 0.2 + pixel.grain * 0.42);

        context.fillStyle = `rgba(${base},${alpha.toFixed(3)})`;
        context.fillRect(
          pixel.x - pixel.size / 2,
          pixel.y + drift * 1.6 - pixel.size / 2,
          pixel.size,
          pixel.size,
        );
      }
    };

    const loop = (time: number) => {
      draw(time);
      frame = window.requestAnimationFrame(loop);
    };

    const observer = new ResizeObserver(() => {
      resize();
      if (reducedMotion) draw(0);
    });
    observer.observe(canvas);
    resize();
    draw(0);
    if (!reducedMotion) frame = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 size-full" />;
}

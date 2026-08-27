import { useEffect, useRef } from "preact/hooks";

const CELL = 76;
/** Phones never draw this, but a narrow desktop window gets a tighter mesh. */
const CELL_NARROW = 58;
/** Cap a frame delta so a background tab does not teleport the pulse. */
const MAX_DELTA_S = 0.064;

/** The clearing engine's own state machine, in order. */
const STATES = [
  "CREATED",
  "QR_PARSED",
  "PRICE_LOCKED",
  "PAYMENT_PENDING",
  "ASSET_RECEIVED",
  "CLEARING",
  "SETTLING",
  "SETTLED",
  "SUCCESS",
] as const;

/**
 * Which of the two rows each state sits on. Steps land between states, never
 * under them, which keeps every vertical run clear of the hero copy.
 */
const ROW = [0, 1, 1, 0, 0, 1, 1, 0, 0] as const;

/** The lower row of the walk, as a fraction of the hero. */
const BASE_Y_RATIO = 0.78;
/** Node pitch, in cells. */
const PITCH_CELLS = 2;

const TRAVEL_S = 0.52;
const DWELL_S = 0.24;
/** How long SUCCESS is held before the run fades and starts over. */
const HOLD_S = 1.5;
const FADE_S = 0.7;
/**
 * How often a leg is replayed. A replayed step re-enters a state it already
 * committed and changes nothing — which is what idempotent means here.
 */
const RETRY_CHANCE = 0.18;

const NODE_SIZE = 9;
const PULSE_SIZE = 7;
const TRAIL = 88;
const TRAIL_STEPS = 10;

const ACCENT = "14,235,46";

type Phase = "walk" | "hold" | "fade";
type Point = Readonly<{ x: number; y: number }>;

/**
 * The nine-state clearing machine, walked. A pulse moves state to state; each
 * state it reaches flashes and then stays committed, because the transition is
 * already persisted. Every so often a leg replays — the pulse falls back and
 * re-enters a state it has already recorded, and nothing about that state
 * changes. Idempotent, resumable, auditable, drawn rather than claimed.
 */
type StateWalkGridProps = Readonly<{
  /** "light" draws ink lines on paper; "dark" draws white lines on the void. */ tone?:
    | "light"
    | "dark";
}>;

export function StateWalkGrid({ tone = "light" }: StateWalkGridProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const base = tone === "dark" ? "255,255,255" : "17,17,17";

  useEffect(() => {
    if (!window.matchMedia("(min-width: 768px)").matches) return;

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let cell = CELL;
    let raf = 0;
    let last = 0;

    let nodes: Point[] = [];
    /** Flash left on each state by the pulse arriving, decaying to nothing. */
    let flashes: number[] = [];

    let phase: Phase = "walk";
    /** The leg being walked, as state indices. `from` may be ahead of `to`. */
    let from = 0;
    let to = 1;
    let committed = 0;
    /** The state the pulse most recently entered — what the label names. */
    let arrived = 0;
    let progress = 0;
    let dwell = 0;
    let timer = 0;

    /** Grid lines land on half pixels so a 1px hairline stays a hairline. */
    const snap = (value: number) => Math.round(value) + 0.5;

    const reset = () => {
      phase = "walk";
      from = 0;
      to = 1;
      committed = 0;
      arrived = 0;
      progress = 0;
      dwell = DWELL_S;
      timer = 0;
      flashes = STATES.map(() => 0);
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

      cell = width < 900 ? CELL_NARROW : CELL;

      const legs = STATES.length - 1;
      const pitch = Math.max(cell, Math.floor((width - cell * 2) / legs / cell) * cell);
      const pitchCells = Math.min(PITCH_CELLS * cell, pitch);
      const startX = snap(Math.round((width - pitchCells * legs) / 2 / cell) * cell);
      const baseY = snap(Math.round((height * BASE_Y_RATIO) / cell) * cell);

      nodes = STATES.map((_, index) => ({
        x: startX + index * pitchCells,
        y: baseY - (ROW[index] ?? 0) * cell,
      }));
      reset();
    };

    /** The L-shaped route between two states: along the row, then the step. */
    const legPath = (a: Point, b: Point): Point[] =>
      a.y === b.y ? [a, b] : [a, { x: b.x, y: a.y }, b];

    const pointOnLeg = (a: Point, b: Point, t: number): Point => {
      const path = legPath(a, b);
      let total = 0;
      const spans: number[] = [];
      for (let i = 1; i < path.length; i += 1) {
        const p = path[i - 1];
        const q = path[i];
        if (!p || !q) continue;
        const span = Math.hypot(q.x - p.x, q.y - p.y);
        spans.push(span);
        total += span;
      }

      let walked = t * total;
      for (let i = 1; i < path.length; i += 1) {
        const p = path[i - 1];
        const q = path[i];
        const span = spans[i - 1];
        if (!p || !q || span === undefined) continue;
        if (walked > span && i < path.length - 1) {
          walked -= span;
          continue;
        }
        const k = span === 0 ? 0 : Math.min(1, walked / span);
        return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k };
      }
      return b;
    };

    const drawGrid = () => {
      context.lineWidth = 1;
      context.strokeStyle = `rgba(${base},0.062)`;
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

    const strokeLeg = (a: Point, b: Point) => {
      const path = legPath(a, b);
      context.beginPath();
      for (let i = 0; i < path.length; i += 1) {
        const point = path[i];
        if (!point) continue;
        if (i === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      }
      context.stroke();
    };

    const drawPath = (alpha: number) => {
      context.lineWidth = 1;
      for (let i = 1; i < nodes.length; i += 1) {
        const a = nodes[i - 1];
        const b = nodes[i];
        if (!a || !b) continue;
        // A leg the machine has already walked is a leg it can prove it walked.
        const done = i <= committed;
        context.strokeStyle = `rgba(${base},${((done ? 0.3 : 0.1) * alpha).toFixed(3)})`;
        strokeLeg(a, b);
      }
    };

    const drawNodes = (alpha: number) => {
      context.lineWidth = 1;
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        if (!node) continue;
        const done = i <= committed;
        const flash = (flashes[i] ?? 0) * alpha;

        if (done) {
          context.fillStyle = `rgba(${base},${(0.62 * alpha).toFixed(3)})`;
          context.fillRect(node.x - NODE_SIZE / 2, node.y - NODE_SIZE / 2, NODE_SIZE, NODE_SIZE);
        } else {
          context.strokeStyle = `rgba(${base},${(0.26 * alpha).toFixed(3)})`;
          context.strokeRect(node.x - NODE_SIZE / 2, node.y - NODE_SIZE / 2, NODE_SIZE, NODE_SIZE);
        }

        if (flash > 0.001) {
          const size = NODE_SIZE + flash * 12;
          context.strokeStyle = `rgba(${ACCENT},${(flash * 0.8).toFixed(3)})`;
          context.strokeRect(node.x - size / 2, node.y - size / 2, size, size);

          const inner = NODE_SIZE - 3;
          context.fillStyle = `rgba(${ACCENT},${flash.toFixed(3)})`;
          context.fillRect(node.x - inner / 2, node.y - inner / 2, inner, inner);
        }
      }
    };

    const drawPulse = (alpha: number) => {
      const a = nodes[from];
      const b = nodes[to];
      if (!a || !b || phase !== "walk" || dwell > 0) return;

      const step = 1 / TRAIL_STEPS;
      context.lineWidth = 1.6;
      for (let i = 0; i < TRAIL_STEPS; i += 1) {
        const head = progress - i * step * (TRAIL / 260);
        const tail = head - step * (TRAIL / 260);
        if (tail <= 0) break;
        const p = pointOnLeg(a, b, tail);
        const q = pointOnLeg(a, b, head);
        const fade = (1 - i / TRAIL_STEPS) ** 1.6;
        context.strokeStyle = `rgba(${ACCENT},${(0.5 * fade * alpha).toFixed(3)})`;
        context.beginPath();
        context.moveTo(p.x, p.y);
        context.lineTo(q.x, q.y);
        context.stroke();
      }

      const head = pointOnLeg(a, b, progress);
      context.fillStyle = `rgba(${ACCENT},${(0.95 * alpha).toFixed(3)})`;
      context.fillRect(head.x - PULSE_SIZE / 2, head.y - PULSE_SIZE / 2, PULSE_SIZE, PULSE_SIZE);
    };

    const drawLabel = (alpha: number) => {
      const node = nodes[arrived];
      const name = STATES[arrived];
      if (!node || !name) return;

      context.font = `500 10px ui-monospace, "Geist Mono Variable", Menlo, monospace`;
      context.textAlign = "center";
      context.textBaseline = "top";
      context.fillStyle = `rgba(${base},${(0.42 * alpha).toFixed(3)})`;
      context.fillText(name, node.x, node.y + NODE_SIZE);
    };

    const commit = (index: number) => {
      committed = Math.max(committed, index);
      arrived = index;
      flashes[index] = 1;
    };

    const advance = (delta: number) => {
      for (let i = 0; i < flashes.length; i += 1) {
        flashes[i] = Math.max(0, (flashes[i] ?? 0) - delta * 2.2);
      }

      if (phase === "hold") {
        timer -= delta;
        if (timer <= 0) {
          phase = "fade";
          timer = FADE_S;
        }
        return;
      }

      if (phase === "fade") {
        timer -= delta;
        if (timer <= 0) reset();
        return;
      }

      if (dwell > 0) {
        dwell -= delta;
        return;
      }

      progress += delta / TRAVEL_S;
      if (progress < 1) return;

      progress = 0;
      commit(to);
      dwell = DWELL_S;

      if (to >= STATES.length - 1) {
        phase = "hold";
        timer = HOLD_S;
        return;
      }

      // A replay walks the same leg again: the state is already recorded, so
      // arriving a second time commits nothing new.
      if (to > 0 && Math.random() < RETRY_CHANCE) {
        from = to - 1;
        return;
      }

      from = to;
      to += 1;
    };

    const draw = () => {
      const alpha = phase === "fade" ? Math.max(0, timer / FADE_S) : 1;
      context.clearRect(0, 0, width, height);
      drawGrid();
      drawPath(alpha);
      drawPulse(alpha);
      drawNodes(alpha);
      drawLabel(alpha);
    };

    const loop = (time: number) => {
      const delta = last === 0 ? 0 : Math.min((time - last) / 1000, MAX_DELTA_S);
      last = time;
      advance(delta);
      draw();
      raf = window.requestAnimationFrame(loop);
    };

    resize();

    if (reduced) {
      // A still frame still has to tell the story: a machine part-way through.
      committed = 4;
      arrived = 4;
      from = 4;
      to = 5;
      progress = 0.5;
      draw();
    } else {
      raf = window.requestAnimationFrame(loop);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [base]);

  return (
    <div aria-hidden="true" class="pointer-events-none absolute inset-0 hidden md:block">
      <canvas ref={canvasRef} class="wave-canvas h-full w-full" />
    </div>
  );
}

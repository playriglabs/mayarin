import { useEffect, useRef } from "preact/hooks";

const CELL = 76;
/** Phones never draw this, but a narrow desktop window gets a tighter mesh. */
const CELL_NARROW = 58;
/** Cap a frame delta so a background tab does not teleport the packets. */
const MAX_DELTA_S = 0.064;

/** The clearing node sits below the hero copy, on the settlement bus. */
const BUS_Y_RATIO = 0.78;
/** Centred: value arrives from both edges and settles out the other side. */
const NODE_X_RATIO = 0.5;
/**
 * How far from the node an inbound packet is allowed to turn onto the bus,
 * in cells. Far enough out that no vertical run crosses the hero copy.
 */
const MIN_TURN_CELLS = 5;
/** Settled packets in flight per side. Three reads as a stream, not a trickle. */
const MAX_SETTLED_PER_SIDE = 3;
const NODE_SIZE = 15;
/** Minimum gap between settled packets, so a burst leaves as a cadence. */
const SETTLE_GAP_S = 0.34;

const MAX_INBOUND = 8;
const SPAWN_MIN_S = 0.34;
const SPAWN_MAX_S = 0.9;
const INBOUND_SPEED = [96, 168] as const;
const SETTLED_SPEED = 260;

const PACKET_SIZE = 6;
const SETTLED_SIZE = 8;
/** Length of the fading wake a packet drags along its own path, in pixels. */
const TRAIL = 128;
const TRAIL_STEPS = 12;

const ACCENT = "14,235,46";

type Point = Readonly<{ x: number; y: number }>;

type Side = "left" | "right";

type Packet = {
  readonly path: readonly Point[];
  /** Cumulative length at each waypoint; `cumulative[i]` ends segment `i - 1`. */
  readonly cumulative: readonly number[];
  readonly total: number;
  readonly speed: number;
  readonly settled: boolean;
  /** For a settled packet, the edge it is heading for. */
  readonly side: Side;
  distance: number;
};

const random = (min: number, max: number) => min + Math.random() * (max - min);

function measure(path: readonly Point[]): { cumulative: number[]; total: number } {
  const cumulative = [0];
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    const from = path[i - 1];
    const to = path[i];
    if (!from || !to) continue;
    total += Math.hypot(to.x - from.x, to.y - from.y);
    cumulative.push(total);
  }
  return { cumulative, total };
}

function pointAt(packet: Packet, distance: number): Point | undefined {
  if (distance <= 0) return packet.path[0];
  for (let i = 1; i < packet.path.length; i += 1) {
    const end = packet.cumulative[i];
    const start = packet.cumulative[i - 1];
    const from = packet.path[i - 1];
    const to = packet.path[i];
    if (end === undefined || start === undefined || !from || !to) continue;
    if (distance > end) continue;
    const span = end - start;
    const t = span === 0 ? 0 : (distance - start) / span;
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  }
  return packet.path[packet.path.length - 1];
}

/**
 * The hero's grid, read as the ledger it is: value enters from either edge on
 * whatever line it arrives on, turns onto the settlement bus, and is absorbed
 * by one clearing node. What leaves is a single settled stream out the far side
 * — many assets in, one currency out, which is the whole product in one picture.
 */
type ClearingGridProps = Readonly<{
  /** "light" draws ink lines on paper; "dark" draws white lines on the void. */ tone?:
    | "light"
    | "dark";
}>;

export function ClearingGrid({ tone = "light" }: ClearingGridProps) {
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
    let busY = 0;
    let nodeX = 0;
    let raf = 0;
    let last = 0;
    let untilSpawn = 0;
    let untilSettle = 0;
    let pulse = 0;
    /** Exit sides waiting to leave the node, oldest first. */
    const cleared: Side[] = [];
    /** Entries and exits alternate, so neither half of the frame goes quiet. */
    let nextEntry: Side = "left";
    let nextExit: Side = "right";

    const packets: Packet[] = [];

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
      busY = snap(Math.round((height * BUS_Y_RATIO) / cell) * cell);
      nodeX = snap(Math.round((width * NODE_X_RATIO) / cell) * cell);
      packets.length = 0;
      cleared.length = 0;
    };

    const spawn = () => {
      if (packets.filter((packet) => !packet.settled).length >= MAX_INBOUND) return;

      // Inbound lines are spread over the band the copy does not sit on.
      const lines = Math.max(2, Math.floor(height / cell));
      const row = Math.round(random(0.38, 0.98) * lines);
      const y = snap(row * cell);
      if (Math.abs(y - busY) < cell * 0.5) return;

      const side = nextEntry;
      nextEntry = side === "left" ? "right" : "left";

      // Turns happen well out from the node, which keeps every vertical run
      // clear of the copy and reads as routing rather than a queue.
      const span = side === "left" ? nodeX / cell : (width - nodeX) / cell;
      const cells = Math.max(MIN_TURN_CELLS, Math.floor(span) - 1);
      const offset = Math.round(random(MIN_TURN_CELLS, cells)) * cell;
      const turnX = snap(side === "left" ? nodeX - offset : nodeX + offset);
      const entry = side === "left" ? -cell : width + cell;

      const path: Point[] = [
        { x: entry, y },
        { x: turnX, y },
        { x: turnX, y: busY },
        { x: nodeX, y: busY },
      ];
      const { cumulative, total } = measure(path);
      packets.push({
        path,
        cumulative,
        total,
        speed: random(INBOUND_SPEED[0], INBOUND_SPEED[1]),
        settled: false,
        side,
        distance: 0,
      });
    };

    const settle = (side: Side) => {
      const inFlight = packets.filter((packet) => packet.settled && packet.side === side).length;
      if (inFlight >= MAX_SETTLED_PER_SIDE) return false;

      const path: Point[] = [
        { x: nodeX, y: busY },
        { x: side === "left" ? -cell : width + cell, y: busY },
      ];
      const { cumulative, total } = measure(path);
      packets.push({
        path,
        cumulative,
        total,
        speed: SETTLED_SPEED,
        settled: true,
        side,
        distance: 0,
      });
      return true;
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

      // The bus is the one line that carries settled value, so it is the one
      // line that is legible on its own.
      context.strokeStyle = `rgba(${base},0.16)`;
      context.beginPath();
      context.moveTo(0, busY);
      context.lineTo(width, busY);
      context.stroke();

      context.strokeStyle = `rgba(${ACCENT},0.26)`;
      context.beginPath();
      context.moveTo(0, busY);
      context.lineTo(width, busY);
      context.stroke();
    };

    const drawTrail = (packet: Packet) => {
      const step = TRAIL / TRAIL_STEPS;
      const colour = packet.settled ? ACCENT : base;
      const peak = packet.settled ? 0.55 : 0.34;

      context.lineWidth = packet.settled ? 1.6 : 1.2;
      for (let i = 0; i < TRAIL_STEPS; i += 1) {
        const head = packet.distance - i * step;
        const tail = head - step;
        if (tail <= 0) break;
        const from = pointAt(packet, tail);
        const to = pointAt(packet, head);
        if (!from || !to) break;
        const alpha = peak * (1 - i / TRAIL_STEPS) ** 1.6;
        context.strokeStyle = `rgba(${colour},${alpha.toFixed(3)})`;
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.stroke();
      }
    };

    const drawPacket = (packet: Packet) => {
      const head = pointAt(packet, packet.distance);
      if (!head) return;
      const size = packet.settled ? SETTLED_SIZE : PACKET_SIZE;
      context.fillStyle = packet.settled ? `rgba(${ACCENT},0.95)` : `rgba(${base},0.72)`;
      context.fillRect(head.x - size / 2, head.y - size / 2, size, size);
    };

    const drawNode = () => {
      const grow = pulse * 9;
      context.lineWidth = 1;
      context.strokeStyle = `rgba(${base},0.62)`;
      context.strokeRect(nodeX - NODE_SIZE / 2, busY - NODE_SIZE / 2, NODE_SIZE, NODE_SIZE);

      if (pulse > 0.001) {
        const side = NODE_SIZE + grow;
        context.strokeStyle = `rgba(${ACCENT},${(pulse * 0.75).toFixed(3)})`;
        context.strokeRect(nodeX - side / 2, busY - side / 2, side, side);
      }

      context.fillStyle = `rgba(${ACCENT},${(0.26 + pulse * 0.68).toFixed(3)})`;
      const inner = NODE_SIZE - 4;
      context.fillRect(nodeX - inner / 2, busY - inner / 2, inner, inner);
    };

    const advance = (delta: number) => {
      untilSpawn -= delta;
      if (untilSpawn <= 0) {
        spawn();
        untilSpawn = random(SPAWN_MIN_S, SPAWN_MAX_S);
      }

      pulse = Math.max(0, pulse - delta * 2.4);

      untilSettle -= delta;
      const next = cleared[0];
      if (next && untilSettle <= 0 && settle(next)) {
        cleared.shift();
        untilSettle = SETTLE_GAP_S;
      }

      for (let i = packets.length - 1; i >= 0; i -= 1) {
        const packet = packets[i];
        if (!packet) continue;
        packet.distance += packet.speed * delta;
        if (packet.distance < packet.total) continue;

        packets.splice(i, 1);
        // An inbound packet is not gone, it is cleared: the node absorbs it,
        // and the same value leaves settled on the far side.
        if (!packet.settled) {
          pulse = 1;
          cleared.push(nextExit);
          nextExit = nextExit === "left" ? "right" : "left";
        }
      }
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      drawGrid();
      for (const packet of packets) drawTrail(packet);
      for (const packet of packets) drawPacket(packet);
      drawNode();
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
      // A still frame still has to tell the story, so seed one of each.
      spawn();
      settle("left");
      settle("right");
      cleared.length = 0;
      for (const packet of packets) packet.distance = packet.total * 0.55;
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

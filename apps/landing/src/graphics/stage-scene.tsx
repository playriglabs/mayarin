import type { ComponentChildren } from "preact";

/**
 * Isometric scenes, one per clearing stage. Drawn on the same 2:1 isometric
 * grid throughout: white line work and hatched faces over the deep green tile,
 * with the accent reserved for the part of the picture the stage is about.
 */

type Point = { x: number; y: number };

const ORIGIN_X = 160;
const ORIGIN_Y = 118;
/** cos(30°) — the horizontal squash of a 2:1 isometric grid. */
const K = 0.866;

function iso(x: number, y: number, z: number): Point {
  return { x: ORIGIN_X + (x - y) * K, y: ORIGIN_Y + (x + y) * 0.5 - z };
}

function shape(points: Point[]): string {
  return `${points.map((p, index) => `${index ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ")} Z`;
}

function line(from: Point, to: Point): string {
  return `M${from.x.toFixed(1)} ${from.y.toFixed(1)} L${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

type BoxProps = {
  hatch: string;
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  z?: number;
  accent?: boolean;
  dim?: number;
  /** Stagger index: orders the entrance and de-syncs the idle float. */
  i?: number;
  float?: boolean;
};

/**
 * An extruded block: hatched sides, an optional accent lid. The outer group
 * owns the entrance, the inner one the idle float, so the two never fight over
 * the same transform.
 */
function Box({
  hatch,
  x,
  y,
  w,
  d,
  h,
  z = 0,
  accent = false,
  dim = 1,
  i = 0,
  float = true,
}: BoxProps) {
  const top = z + h;
  return (
    <g class="iso-in" style={`--i:${i}`}>
      <g class={float ? "iso-float" : undefined} style={`--i:${i}`} opacity={dim}>
        <path
          d={shape([
            iso(x, y + d, z),
            iso(x, y + d, top),
            iso(x + w, y + d, top),
            iso(x + w, y + d, z),
          ])}
          fill={`url(#${hatch})`}
        />
        <path
          d={shape([
            iso(x + w, y, z),
            iso(x + w, y, top),
            iso(x + w, y + d, top),
            iso(x + w, y + d, z),
          ])}
          fill={`url(#${hatch})`}
          opacity="0.6"
        />
        <path
          d={shape([
            iso(x, y, top),
            iso(x + w, y, top),
            iso(x + w, y + d, top),
            iso(x, y + d, top),
          ])}
          fill={accent ? "var(--color-accent)" : "none"}
          stroke={accent ? "var(--color-accent)" : "currentColor"}
        />
      </g>
    </g>
  );
}

/** The ground the scene stands on. Its dashes drift, so the tile never freezes. */
function Plane({ size = 78, dashed = true }: { size?: number; dashed?: boolean }) {
  return (
    <path
      class={dashed ? "iso-in iso-flow" : "iso-in"}
      d={shape([
        iso(-size, -size, 0),
        iso(size, -size, 0),
        iso(size, size, 0),
        iso(-size, size, 0),
      ])}
      stroke-dasharray={dashed ? "2 5" : undefined}
      opacity="0.4"
    />
  );
}

/** A guide line: dashed, and always drifting in the direction of travel. */
function Flow({
  d,
  opacity = 0.55,
  accent = false,
  delay = 0,
}: {
  d: string;
  opacity?: number;
  accent?: boolean;
  delay?: number;
}) {
  return (
    <path
      class="iso-in iso-flow"
      style={delay ? `animation-delay:0ms,${delay}ms` : undefined}
      d={d}
      stroke-dasharray="2 5"
      opacity={opacity}
      stroke={accent ? "var(--color-accent)" : undefined}
    />
  );
}

/**
 * The accent path of a stage, with a packet running it end to end — the value
 * moving through the stage, rather than the line drawing itself once.
 */
function Travel({ d, i = 0 }: { d: string; i?: number }) {
  return (
    <g class="iso-in" style={`--i:${i}`}>
      <path d={d} opacity="0.28" stroke="var(--color-accent)" stroke-width="1.2" />
      <path
        class="iso-travel"
        d={d}
        stroke="var(--color-accent)"
        stroke-width="1.8"
        pathLength={100}
        stroke-dasharray="8 92"
      />
    </g>
  );
}

/** A node that keeps a heartbeat. */
function Pulse({
  cx,
  cy,
  i = 0,
  accent = true,
}: {
  cx: number;
  cy: number;
  i?: number;
  accent?: boolean;
}) {
  const colour = accent ? "var(--color-accent)" : "currentColor";
  return (
    // A white node is a bystander in these scenes; only the accent one is the
    // subject, so the rest sit back.
    <g class="iso-in" style={`--i:${i}`} opacity={accent ? 1 : 0.45}>
      <circle cx={cx} cy={cy} r={accent ? 4.5 : 3.5} fill={colour} stroke="none" />
      <circle
        class="iso-pulse"
        style={`--i:${i}`}
        cx={cx}
        cy={cy}
        r={accent ? 11 : 8}
        stroke={colour}
      />
    </g>
  );
}

function Scene({ id, children }: { id: string; children: ComponentChildren }) {
  return (
    <svg
      viewBox="0 0 320 210"
      class="h-full w-full text-white"
      fill="none"
      stroke="currentColor"
      stroke-width="1.1"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id={`hatch-${id}`}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(60)"
        >
          <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" stroke-width="1" opacity="0.34" />
        </pattern>
      </defs>
      {children}
    </svg>
  );
}

const scene01 = () => (
  <Scene id="01">
    <Plane />
    <Box hatch="hatch-01" x={-46} y={-46} w={44} d={44} h={30} accent i={1} />
    <Flow d="M118 92C142 58 210 52 244 78" opacity={0.75} accent />
    <Box hatch="hatch-01" x={26} y={22} w={40} d={40} h={10} dim={0.9} i={2} />
    <Pulse cx={244} cy={78} i={3} />
  </Scene>
);

const scene02 = () => (
  <Scene id="02">
    <Box hatch="hatch-02" x={-58} y={-58} w={96} d={96} h={7} dim={0.45} i={0} />
    <Box hatch="hatch-02" x={-46} y={-46} w={96} d={96} h={7} z={30} dim={0.7} i={1} />
    <Box hatch="hatch-02" x={-34} y={-34} w={96} d={96} h={7} z={60} accent i={2} />
    {/* Each version stacks on the one below, and the write travels up. */}
    <Travel d={line(iso(14, 14, 7), iso(14, 14, 60))} i={3} />
  </Scene>
);

const scene03 = () => (
  <Scene id="03">
    {[62, 92, 122].map((cy, index) => (
      <ellipse
        key={cy}
        class="iso-in iso-flow"
        style={`--i:${index};animation-delay:calc(${index} * 70ms),${index * -800}ms`}
        cx="160"
        cy={cy}
        rx="104"
        ry="36"
        stroke-dasharray="2 5"
        opacity="0.55"
      />
    ))}
    <Travel d="M74 74C120 108 200 108 246 74" i={2} />
    <Pulse cx={74} cy={74} i={2} />
    <Pulse cx={246} cy={74} i={3} />
    <Pulse cx={160} cy={128} i={4} accent={false} />
    <Pulse cx={226} cy={140} i={5} accent={false} />
    <Pulse cx={96} cy={46} i={6} accent={false} />
    <Box hatch="hatch-03" x={-20} y={-20} w={40} d={40} h={14} z={26} i={1} />
  </Scene>
);

const scene04 = () => (
  <Scene id="04">
    <Box hatch="hatch-04" x={-42} y={-42} w={84} d={84} h={6} z={26} accent i={0} />
    <Box hatch="hatch-04" x={-42} y={-42} w={84} d={84} h={6} z={-30} i={1} />
    {[
      [-42, -42],
      [42, -42],
      [-42, 42],
      [42, 42],
    ].map(([x, y], index) => (
      <Flow
        key={`${x}:${y}`}
        d={line(iso(x ?? 0, y ?? 0, -24), iso(x ?? 0, y ?? 0, 26))}
        opacity={0.5}
        delay={index * -600}
      />
    ))}
    <Flow d={line(iso(-72, -72, -2), iso(72, 72, -2))} opacity={0.3} />
  </Scene>
);

const scene05 = () => (
  <Scene id="05">
    <Box hatch="hatch-05" x={-88} y={-30} w={56} d={56} h={16} dim={0.9} i={0} />
    <Box hatch="hatch-05" x={34} y={-30} w={56} d={56} h={16} accent i={1} />
    <Flow d="M104 118C136 74 190 66 224 86" opacity={0.55} />
    <Travel d="M228 108C196 148 140 152 108 134" i={2} />
    <path
      class="iso-in"
      style="--i:3"
      d="M118 128l-12 6 4-12"
      stroke="var(--color-accent)"
      stroke-width="1.6"
    />
  </Scene>
);

const scene06 = () => (
  <Scene id="06">
    <Plane size={92} />
    {[
      { x: -84, h: 34, accent: false },
      { x: -50, h: 58, accent: false },
      { x: -16, h: 44, accent: false },
      { x: 18, h: 74, accent: false },
      { x: 52, h: 96, accent: true },
    ].map((column, index) => (
      <Box
        key={column.x}
        hatch="hatch-06"
        x={column.x}
        y={-16}
        w={28}
        d={28}
        h={column.h}
        accent={column.accent}
        i={index}
      />
    ))}
    <Travel d={line(iso(-70, -2, 34), iso(66, -2, 96))} i={5} />
  </Scene>
);

/** Factories, not elements: the same scene renders in two trees at once. */
export const stageScenes: Record<string, () => ComponentChildren> = {
  "01": scene01,
  "02": scene02,
  "03": scene03,
  "04": scene04,
  "05": scene05,
  "06": scene06,
};

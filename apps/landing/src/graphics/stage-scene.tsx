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
};

/** An extruded block: hatched sides, an optional accent lid. */
function Box({ hatch, x, y, w, d, h, z = 0, accent = false, dim = 1 }: BoxProps) {
  const top = z + h;
  return (
    <g opacity={dim}>
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
        d={shape([iso(x, y, top), iso(x + w, y, top), iso(x + w, y + d, top), iso(x, y + d, top)])}
        fill={accent ? "var(--color-accent)" : "none"}
        stroke={accent ? "var(--color-accent)" : "currentColor"}
      />
    </g>
  );
}

function Plane({ size = 78, dashed = true }: { size?: number; dashed?: boolean }) {
  return (
    <path
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
    <Box hatch="hatch-01" x={-46} y={-46} w={44} d={44} h={30} accent />
    <path
      d="M118 92C142 58 210 52 244 78"
      stroke-dasharray="2 5"
      opacity="0.75"
      stroke="var(--color-accent)"
    />
    <Box hatch="hatch-01" x={26} y={22} w={40} d={40} h={10} dim={0.9} />
    <circle cx="244" cy="78" r="4.5" fill="var(--color-accent)" stroke="none" />
    <circle cx="244" cy="78" r="11" stroke="var(--color-accent)" opacity="0.5" />
  </Scene>
);

const scene02 = () => (
  <Scene id="02">
    <Box hatch="hatch-02" x={-58} y={-58} w={96} d={96} h={7} dim={0.45} />
    <Box hatch="hatch-02" x={-46} y={-46} w={96} d={96} h={7} z={30} dim={0.7} />
    <Box hatch="hatch-02" x={-34} y={-34} w={96} d={96} h={7} z={60} accent />
    <path
      d={line(iso(14, 14, 7), iso(14, 14, 60))}
      stroke-dasharray="2 5"
      opacity="0.6"
      stroke="var(--color-accent)"
    />
  </Scene>
);

const scene03 = () => (
  <Scene id="03">
    {[62, 92, 122].map((cy) => (
      <ellipse key={cy} cx="160" cy={cy} rx="104" ry="36" stroke-dasharray="2 5" opacity="0.55" />
    ))}
    <path
      d="M74 74C120 108 200 108 246 74"
      stroke="var(--color-accent)"
      stroke-width="1.6"
      pathLength={100}
      stroke-dasharray="100"
      class="stage-draw"
    />
    <circle cx="74" cy="74" r="5" fill="var(--color-accent)" stroke="none" />
    <circle cx="246" cy="74" r="5" fill="var(--color-accent)" stroke="none" />
    <circle cx="160" cy="128" r="4.5" fill="currentColor" stroke="none" opacity="0.85" />
    <circle cx="226" cy="140" r="4.5" fill="currentColor" stroke="none" opacity="0.85" />
    <circle cx="96" cy="46" r="4.5" fill="currentColor" stroke="none" opacity="0.85" />
    <Box hatch="hatch-03" x={-20} y={-20} w={40} d={40} h={14} z={26} />
  </Scene>
);

const scene04 = () => (
  <Scene id="04">
    <Box hatch="hatch-04" x={-42} y={-42} w={84} d={84} h={6} z={26} accent />
    <Box hatch="hatch-04" x={-42} y={-42} w={84} d={84} h={6} z={-30} />
    {[
      [-42, -42],
      [42, -42],
      [-42, 42],
      [42, 42],
    ].map(([x, y]) => (
      <path
        key={`${x}:${y}`}
        d={line(iso(x ?? 0, y ?? 0, -24), iso(x ?? 0, y ?? 0, 26))}
        stroke-dasharray="2 5"
        opacity="0.5"
      />
    ))}
    <path d={line(iso(-72, -72, -2), iso(72, 72, -2))} opacity="0.3" stroke-dasharray="2 5" />
  </Scene>
);

const scene05 = () => (
  <Scene id="05">
    <Box hatch="hatch-05" x={-88} y={-30} w={56} d={56} h={16} dim={0.9} />
    <Box hatch="hatch-05" x={34} y={-30} w={56} d={56} h={16} accent />
    <path d="M104 118C136 74 190 66 224 86" stroke-dasharray="2 5" opacity="0.55" />
    <path
      d="M228 108C196 148 140 152 108 134"
      stroke="var(--color-accent)"
      stroke-width="1.6"
      pathLength={100}
      stroke-dasharray="100"
      class="stage-draw"
    />
    <path d="M118 128l-12 6 4-12" stroke="var(--color-accent)" stroke-width="1.6" />
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
    ].map((column) => (
      <Box
        key={column.x}
        hatch="hatch-06"
        x={column.x}
        y={-16}
        w={28}
        d={28}
        h={column.h}
        accent={column.accent}
      />
    ))}
    <path
      d={line(iso(-70, -2, 34), iso(66, -2, 96))}
      stroke="var(--color-accent)"
      stroke-width="1.6"
      opacity="0.85"
      pathLength={100}
      stroke-dasharray="100"
      class="stage-draw"
    />
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

import clsx from "clsx";
import createGlobe, { type Arc, type COBEOptions, type Marker } from "cobe";
import { useEffect, useRef } from "preact/hooks";

type City = {
  id: string;
  label: string;
  location: [number, number];
};

/**
 * A route rather than a hub. Every corridor used to be drawn back to Jakarta,
 * which bundled ten arcs into one point and read as a starburst; hopping city
 * to city gives each stop two lines and shows value actually travelling.
 *
 * The order is the story: out through Asia first, where the adoption is, then
 * across the Pacific to the Americas and back over the Atlantic into Europe,
 * the Gulf and South Asia. It stops at Mumbai rather than closing the ring —
 * a Mumbai-to-Jakarta hop would sling one more arc across the whole face.
 *
 * Neighbouring entries are kept geographically close on purpose: the longer
 * the hop, the further its arc bows off the sphere.
 */
const ROUTE: City[] = [
  { id: "sydney", label: "Sydney", location: [-33.8688, 151.2093] },
  { id: "jakarta", label: "Jakarta", location: [-6.2088, 106.8456] },
  { id: "singapore", label: "Singapore", location: [1.3521, 103.8198] },
  { id: "kualalumpur", label: "Kuala Lumpur", location: [3.139, 101.6869] },
  { id: "bangkok", label: "Bangkok", location: [13.7563, 100.5018] },
  { id: "manila", label: "Manila", location: [14.5995, 120.9842] },
  { id: "hongkong", label: "Hong Kong", location: [22.3193, 114.1694] },
  { id: "seoul", label: "Seoul", location: [37.5665, 126.978] },
  { id: "tokyo", label: "Tokyo", location: [35.6762, 139.6503] },
  { id: "sanfrancisco", label: "San Francisco", location: [37.7749, -122.4194] },
  { id: "newyork", label: "New York", location: [40.7128, -74.006] },
  { id: "saopaulo", label: "São Paulo", location: [-23.5505, -46.6333] },
  { id: "london", label: "London", location: [51.5074, -0.1278] },
  { id: "frankfurt", label: "Frankfurt", location: [50.1109, 8.6821] },
  { id: "dubai", label: "Dubai", location: [25.2048, 55.2708] },
  { id: "mumbai", label: "Mumbai", location: [19.076, 72.8777] },
];

/** Jakarta stays the origin — first stop, and the one drawn heaviest. */
const HUB = ROUTE[0] as City;

/* Every stop is named. An unlabelled dot just reads as an unexplained speck;
   overlapping chips are culled per frame instead. */
const LABELLED = ROUTE;

const MARKERS: Marker[] = ROUTE.map((city) => ({
  location: city.location,
  size: city.id === HUB.id ? 0.055 : 0.028,
}));

/** One hop per consecutive pair — an open path, not a ring. */
const ARCS: Arc[] = ROUTE.slice(0, -1).map((city, index) => ({
  from: city.location,
  to: (ROUTE[index + 1] as City).location,
}));

/** Longitude the globe opens on, so Jakarta faces the reader from the start. */
const START_PHI = 4.1;
const THETA = 0.22;
/** ~21s per revolution: plainly turning, without pulling the eye off the copy. */
const SPIN_PER_FRAME = 0.005;
/** Pixels of drag per radian. Higher is heavier. */
const DRAG_SCALE = 240;
/** cobe draws the sphere at 0.8 of the clip volume. */
const GLOBE_RADIUS = 0.8;

const { PI, sin, cos } = Math;

/**
 * cobe's own lat/lon to unit vector, mirrored from its source so a label can
 * never drift off the marker it belongs to.
 */
function toVector([lat, lon]: [number, number]): [number, number, number] {
  const a = (lat * PI) / 180;
  const b = (lon * PI) / 180 - PI;
  const c = cos(a);
  return [-c * cos(b), sin(a), c * sin(b)];
}

/**
 * Rotate by phi then theta and drop to screen space. Matches the rotation cobe
 * builds in its vertex shader; `depth` is positive on the facing hemisphere.
 */
function project(
  location: [number, number],
  phi: number,
  theta: number,
  size: number,
): { x: number; y: number; depth: number } {
  const [vx, vy, vz] = toVector(location);
  const cp = cos(phi);
  const sp = sin(phi);
  const ct = cos(theta);
  const st = sin(theta);

  const x = cp * vx + sp * vz;
  const y = sp * st * vx + ct * vy - cp * st * vz;
  const depth = -sp * ct * vx + st * vy + cp * ct * vz;

  return {
    x: (x * GLOBE_RADIUS * 0.5 + 0.5) * size,
    y: (0.5 - y * GLOBE_RADIUS * 0.5) * size,
    depth,
  };
}

/**
 * The corridor map, rendered with `cobe` — framework-agnostic, so there is
 * nothing React-specific to adapt for Preact.
 *
 * cobe draws exactly one frame when it is created and ships no render loop of
 * its own: animating it means calling `update()` on your own rAF. That loop is
 * also the only thing that makes the land appear, since cobe decodes its dot
 * map asynchronously and the first frame lands before it is ready.
 *
 * Labels are positioned from the same maths cobe uses internally rather than
 * from its anchor-name hooks, which would tie them to CSS anchor positioning.
 */
export function Globe({ class: className = "" }: { class?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    const layer = layerRef.current;
    if (!canvas || !frame || !layer) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const chips = new Map<string, HTMLElement>();
    for (const city of LABELLED) {
      const chip = layer.querySelector<HTMLElement>(`[data-city="${city.id}"]`);
      if (chip) chips.set(city.id, chip);
    }

    let globe: ReturnType<typeof createGlobe> | undefined;
    let size = frame.clientWidth;
    let drawnAtSize = size;
    let phi = START_PHI;
    /** Screen x where the current drag began, or null when nobody is dragging. */
    let grabbedAt: number | null = null;
    let spun = 0;
    let raf = 0;

    const resizeObserver = new ResizeObserver(() => {
      size = frame.clientWidth;
      measureChips();
    });
    resizeObserver.observe(frame);

    /* Chip sizes only change with the font or the viewport, so they are cached
       rather than measured on every frame. */
    const chipSize = new Map<string, { w: number; h: number }>();
    const measureChips = () => {
      for (const [id, chip] of chips) {
        chipSize.set(id, { w: chip.offsetWidth, h: chip.offsetHeight });
      }
    };

    const hide = (chip: HTMLElement) => {
      chip.style.opacity = "0";
      chip.style.visibility = "hidden";
    };

    const placeLabels = (angle: number) => {
      /* Nearest first, so when two cities collide the one facing the reader is
         the one that keeps its label. */
      const ordered = LABELLED.map((city) => ({
        city,
        ...project(city.location, angle, THETA, size),
      })).sort((a, b) => b.depth - a.depth);

      const taken: { left: number; right: number; top: number; bottom: number }[] = [];

      for (const { city, x, y, depth } of ordered) {
        const chip = chips.get(city.id);
        if (!chip) continue;

        /* Fade out as a city turns towards the limb so chips never pile up on
           the far edge or flicker across the horizon. */
        const facing = depth > 0.12 ? Math.min(1, (depth - 0.12) / 0.22) : 0;
        if (facing === 0) {
          hide(chip);
          continue;
        }

        const { w, h } = chipSize.get(city.id) ?? { w: 0, h: 0 };
        const left = x - 6;
        const top = y - h * 1.6;
        const box = { left, right: left + w, top, bottom: top + h };

        const overlaps = taken.some(
          (other) =>
            box.left < other.right &&
            box.right > other.left &&
            box.top < other.bottom &&
            box.bottom > other.top,
        );
        if (overlaps) {
          hide(chip);
          continue;
        }

        taken.push(box);
        /* The second translate is in the chip's own size, lifting it clear of
           the marker. It has to live here: a Tailwind transform class would be
           overwritten by this very assignment. */
        chip.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-6px, -160%)`;
        chip.style.opacity = `${facing}`;
        chip.style.visibility = "visible";
      }
    };

    const draw = () => {
      if (!globe) return;

      if (!reduced && grabbedAt === null) phi += SPIN_PER_FRAME;
      const angle = phi + spun;

      const patch: Partial<COBEOptions> = { phi: angle };
      /* Assigning width remakes the drawing buffer, so only on a real resize. */
      if (size !== drawnAtSize) {
        patch.width = size;
        patch.height = size;
        drawnAtSize = size;
      }

      globe.update(patch);
      placeLabels(angle);
      raf = requestAnimationFrame(draw);
    };

    const play = () => {
      if (raf === 0) raf = requestAnimationFrame(draw);
    };

    const pause = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const build = () => {
      if (globe || size === 0) return;
      drawnAtSize = size;
      measureChips();
      /* The mono face loads late; a chip measured before it lands is the wrong
         width, which would throw off collision culling. */
      document.fonts?.ready.then(measureChips).catch(() => {});

      globe = createGlobe(canvas, {
        /* cobe multiplies these by devicePixelRatio itself, so they are CSS
           pixels. Its README doubles them on top of that, which renders at 4x
           for no visible gain — the land dots read the same at 2x. */
        devicePixelRatio: Math.min(window.devicePixelRatio, 2),
        width: size,
        height: size,
        phi: START_PHI,
        theta: THETA,
        dark: 0,
        /* On white, the land map only reads once the base is knocked off pure
           white and the dots are dimmed well below cobe's default. */
        diffuse: 0.6,
        mapSamples: 18000,
        mapBrightness: 1.4,
        baseColor: [0.97, 0.97, 0.97],
        markerColor: [0.055, 0.92, 0.18],
        glowColor: [1, 1, 1],
        markers: MARKERS,
        arcs: ARCS,
        arcColor: [0.122, 0.435, 0.329],
        arcWidth: 0.3,
        /* Height scales with hop length, so anything above ~0.15 sends the
           intercontinental legs looping out into white space. */
        arcHeight: 0.12,
      });
    };

    /* Hold off on the WebGL context until the section is reached, and stop
       drawing once it leaves — an unseen globe should not cost a frame. */
    const visibility = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            build();
            play();
          } else {
            pause();
          }
        }
      },
      { rootMargin: "200px" },
    );
    visibility.observe(frame);

    const onPointerDown = (event: PointerEvent) => {
      grabbedAt = event.clientX - spun * DRAG_SCALE;
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "grabbing";
    };

    const onPointerMove = (event: PointerEvent) => {
      if (grabbedAt === null) return;
      spun = (event.clientX - grabbedAt) / DRAG_SCALE;
    };

    const onPointerUp = (event: PointerEvent) => {
      grabbedAt = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      canvas.style.cursor = "grab";
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    return () => {
      pause();
      visibility.disconnect();
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      globe?.destroy();
    };
  }, []);

  return (
    <div ref={frameRef} class={clsx("relative aspect-square w-full overflow-hidden", className)}>
      <canvas
        ref={canvasRef}
        class="size-full cursor-grab touch-pan-y contain-[layout_paint_size]"
        aria-label="Rotating globe. Mayarin's merchant footprint runs from Jakarta out through Singapore, Kuala Lumpur, Bangkok, Manila, Hong Kong, Seoul and Tokyo, on to San Francisco, New York and São Paulo, then London, Frankfurt, Dubai and Mumbai before closing back to Jakarta."
        role="img"
      />

      {/* Chips ride on top of the canvas. The layer is inert so a drag that
          starts on a label still reaches the globe underneath. */}
      <div ref={layerRef} aria-hidden="true" class="pointer-events-none absolute inset-0">
        {LABELLED.map((city) => (
          <span
            key={city.id}
            data-city={city.id}
            class="label absolute top-0 left-0 whitespace-nowrap bg-ink px-1.5 py-1 text-white will-change-transform"
            style="visibility:hidden"
          >
            {city.label}
          </span>
        ))}
      </div>
    </div>
  );
}

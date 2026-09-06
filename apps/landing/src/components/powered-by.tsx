import clsx from "clsx";
import { useEffect, useRef } from "preact/hooks";

type Logo = {
  src: string;
  name: string;
  /** Lockups already carry the name; marks get one set beside them. */
  lockup?: boolean;
  class?: string;
};

const LOGOS: Logo[] = [
  // { src: "/images/logos/tempo.svg", name: "Tempo", lockup: true, class: "h-4 md:h-[1.35rem]" },
  // { src: "/images/logos/solana.svg", name: "Solana", lockup: true, class: "h-4 md:h-[1.35rem]" },
  { src: "/images/logos/base.svg", name: "Base", lockup: true, class: "h-4 md:h-[1.35rem]" },
  {
    src: "/images/logos/arbitrum.svg",
    name: "Arbitrum",
    lockup: true,
    class: "h-12 md:h-[4rem]",
  },
  { src: "/images/logos/polygon.svg", name: "Polygon", lockup: true, class: "h-6 md:h-[2rem]" },
  {
    src: "/images/logos/arc.svg",
    name: "Arc",
    lockup: true,
    class: "h-5 md:h-[1.5rem]",
  },
  {
    src: "/images/logos/x402.svg",
    name: "x402",
    lockup: true,
    class: "h-5 md:h-[1.5rem]",
  },
  {
    src: "/images/logos/the-graph.svg",
    name: "The Graph",
    lockup: true,
    class: "h-8 md:h-[2.25rem]",
  },
  {
    src: "/images/logos/pyth.svg",
    name: "Pyth Network",
    lockup: true,
    class: "h-8 md:h-[2.5rem]",
  },
  {
    src: "/images/logos/chainlink.svg",
    name: "Chainlink",
    lockup: true,
    class: "h-6 md:h-[2rem]",
  },
  { src: "/images/logos/uniswap.svg", name: "Uniswap", lockup: true, class: "h-8 md:h-[3rem]" },
  { src: "/images/logos/0x.svg", name: "0x Protocol", lockup: true, class: "h-4 md:h-[1.35rem]" },
  { src: "/images/logos/alchemy.svg", name: "Alchemy" },
  { src: "/images/logos/viem.svg", name: "viem", lockup: true, class: "h-4 md:h-[1.25rem]" },
  {
    src: "/images/logos/privy.svg",
    name: "Privy",
    lockup: true,
    class: "h-5 md:h-[1.375rem]",
  },
  { src: "/images/logos/turnkey.svg", name: "Turnkey", lockup: true, class: "h-5 md:h-[1.5rem]" },
  {
    src: "/images/logos/safe-wallet.svg",
    name: "Safe{Wallet}",
    lockup: true,
    class: "h-8 md:h-[2.5rem]",
  },
];

/** Two logo copies make one sequence wider than the widest visible track. */
const LOGO_COPIES_PER_SEQUENCE = 2;
/** Two equal sequences give the animation an exact, invisible handoff point. */
const MARQUEE_SEQUENCES = 2;
/**
 * One pace at every width. A fixed duration made the strip race on a wide
 * viewport and crawl on a phone, because the distance it had to cover changed
 * and the time it was given did not.
 */
const MARQUEE_PIXELS_PER_SECOND = 110;

/**
 * Drive the loop from a measured sequence width.
 *
 * The strip jumped because the animation travelled `-50%` of a track whose
 * width was still changing: the logos are SVGs with no intrinsic width until
 * they decode, and the gaps change at each breakpoint. Measuring the first
 * sequence and translating by exactly that many pixels makes the handoff exact,
 * and re-measuring on resize keeps it exact.
 *
 * The variables are only written when the rounded value actually changes —
 * assigning the duration mid-flight restarts the animation, which is its own
 * visible jump.
 */
function useMarqueeDistance(
  track: { current: HTMLDivElement | null },
  sequence: { current: HTMLUListElement | null },
) {
  useEffect(() => {
    const trackNode = track.current;
    const sequenceNode = sequence.current;
    if (!trackNode || !sequenceNode) return;

    let applied = 0;

    const measure = () => {
      const width = Math.round(sequenceNode.getBoundingClientRect().width);
      // Sub-pixel layout noise is not a new distance; rewriting the variables
      // for it would shift the animation's progress for nothing.
      if (width === 0 || Math.abs(width - applied) < 2) return;
      applied = width;
      trackNode.style.setProperty("--marquee-distance", `${width}px`);
      trackNode.style.setProperty(
        "--marquee-duration",
        `${(width / MARQUEE_PIXELS_PER_SECOND).toFixed(2)}s`,
      );
    };

    measure();

    // A decoding SVG changes the width after the first measurement, and there is
    // no single event for "every logo has settled" — the observer is the event.
    const observer = new ResizeObserver(measure);
    observer.observe(sequenceNode);

    return () => observer.disconnect();
  }, [track, sequence]);
}

function LogoItem({ logo, muted }: { logo: Logo; muted: boolean }) {
  return (
    <li class="flex shrink-0 items-center gap-2.5 opacity-60 grayscale transition-all duration-300 hover:opacity-100 hover:grayscale-0">
      <img
        src={logo.src}
        alt={logo.lockup && !muted ? logo.name : ""}
        loading="eager"
        decoding="async"
        class={clsx("w-auto", logo.class ?? "h-7 md:h-8")}
      />
      {logo.lockup ? null : (
        <span class="mt-1 whitespace-nowrap font-sans text-sm uppercase font-bold text-ink md:text-base">
          {logo.name}
        </span>
      )}
    </li>
  );
}

export function PoweredBy() {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const sequenceRef = useRef<HTMLUListElement | null>(null);
  useMarqueeDistance(trackRef, sequenceRef);

  return (
    <div class="relative mt-20 border-y border-line md:mt-28 bg-white">
      <div class="shell flex flex-col gap-5 py-6 md:flex-row md:items-center md:gap-10 md:py-4">
        <span class="label shrink-0 text-slate text-center">Powered By</span>

        {/* Phones bleed the track past the shell padding so the strip runs edge
            to edge; from tablet up it sits inline beside the label.
            The mobile top margin is dropped at md: in a centred row it offsets
            the logos against the label instead of spacing them. */}
        <div
          ref={trackRef}
          class="marquee-track relative -mx-6 mt-2 min-w-0 flex-1 overflow-hidden mask-[linear-gradient(to_right,transparent,#000_5%,#000_93%,transparent)] md:mx-0 md:mt-0"
        >
          <div class="marquee flex w-max items-center">
            {Array.from({ length: MARQUEE_SEQUENCES }, (_, sequence) => (
              <ul
                key={sequence}
                // Only the first sequence is measured; a conditional `ref` prop
                // cannot be `undefined` under exactOptionalPropertyTypes.
                ref={(node) => {
                  if (sequence === 0) sequenceRef.current = node;
                }}
                aria-hidden={sequence > 0}
                class="flex shrink-0 items-center gap-x-10 pr-10 md:gap-x-14 md:pr-14 lg:gap-x-20 lg:pr-20"
              >
                {Array.from({ length: LOGO_COPIES_PER_SEQUENCE }, (_, copy) =>
                  LOGOS.map((logo) => (
                    <LogoItem
                      key={`${copy}:${logo.name}`}
                      logo={logo}
                      muted={sequence > 0 || copy > 0}
                    />
                  )),
                )}
              </ul>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

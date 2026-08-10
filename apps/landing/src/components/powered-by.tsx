import clsx from "clsx";

type Logo = {
  src: string;
  name: string;
  /** Lockups already carry the name; marks get one set beside them. */
  lockup?: boolean;
  class?: string;
};

const LOGOS: Logo[] = [
  { src: "/images/logos/tempo.svg", name: "Tempo", lockup: true, class: "h-4 md:h-[1.35rem]" },
  { src: "/images/logos/base.svg", name: "Base", lockup: true, class: "h-4 md:h-[1.35rem]" },
  {
    src: "/images/logos/arbitrum.svg",
    name: "Arbitrum",
    lockup: true,
    class: "h-12 md:h-[4rem]",
  },
  { src: "/images/logos/solana.svg", name: "Solana", lockup: true, class: "h-4 md:h-[1.35rem]" },
  { src: "/images/logos/polygon.svg", name: "Polygon", lockup: true, class: "h-6 md:h-[2rem]" },
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
  { src: "/images/logos/turnkey.svg", name: "Turnkey", lockup: true, class: "h-5 md:h-[1.5rem]" },
];

/** Enough copies that the first half always overflows the widest viewport. */
const MARQUEE_COPIES = 4;

function LogoItem({ logo, muted }: { logo: Logo; muted: boolean }) {
  return (
    <li class="flex shrink-0 items-center gap-2.5 opacity-60 grayscale transition-all duration-300 hover:opacity-100 hover:grayscale-0">
      <img
        src={logo.src}
        alt={logo.lockup && !muted ? logo.name : ""}
        loading="lazy"
        decoding="async"
        class={clsx("w-auto", logo.class ?? "h-7 md:h-8")}
      />
      {logo.lockup ? null : (
        <span class="mt-1 whitespace-nowrap font-brand text-sm uppercase font-bold text-ink md:text-base">
          {logo.name}
        </span>
      )}
    </li>
  );
}

export function PoweredBy() {
  return (
    <div class="relative mt-20 border-y border-line md:mt-28">
      <div class="shell flex flex-col gap-5 py-6 md:flex-row md:items-center md:gap-10 md:py-8">
        <span class="label shrink-0 text-slate text-center">Powered By</span>

        {/* Phones bleed the track past the shell padding so the strip runs edge
            to edge; from tablet up it sits inline beside the label.
            The mobile top margin is dropped at md: in a centred row it offsets
            the logos against the label instead of spacing them. */}
        <div class="marquee-track relative -mx-6 mt-2 min-w-0 flex-1 overflow-hidden mask-[linear-gradient(to_right,transparent,#000_5%,#000_93%,transparent)] md:mx-0 md:mt-0">
          <ul class="marquee flex w-max items-center gap-x-10 md:gap-x-14 lg:gap-x-20">
            {Array.from({ length: MARQUEE_COPIES }, (_, copy) =>
              LOGOS.map((logo) => (
                <LogoItem key={`${copy}:${logo.name}`} logo={logo} muted={copy > 0} />
              )),
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

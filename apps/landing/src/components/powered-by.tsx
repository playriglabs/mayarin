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
  { src: "/images/logos/arbitrum.svg", name: "Arbitrum" },
  { src: "/images/logos/polygon.svg", name: "Polygon" },
  { src: "/images/logos/alchemy.svg", name: "Alchemy" },
  { src: "/images/logos/viem.svg", name: "viem", lockup: true, class: "h-4 md:h-[1.25rem]" },
];

/** Enough copies that the first half always overflows the widest viewport. */
const MARQUEE_COPIES = 4;

function LogoItem({ logo, muted, scale }: { logo: Logo; muted: boolean; scale: boolean }) {
  return (
    <li class="flex shrink-0 items-center gap-2.5 opacity-60 grayscale transition-all duration-300 hover:opacity-100 hover:grayscale-0">
      <img
        src={logo.src}
        alt={logo.lockup && !muted ? logo.name : ""}
        loading="lazy"
        decoding="async"
        class={`w-auto ${logo.class ?? (scale ? "h-5 md:h-7" : "h-5")}`}
      />
      {logo.lockup ? null : (
        <span
          class={`whitespace-nowrap text-ink ${scale ? "text-sm md:text-base uppercase font-brand mt-1" : "text-sm"}`}
        >
          {logo.name}
        </span>
      )}
    </li>
  );
}

export function PoweredBy() {
  return (
    <div class="relative mt-20 border-y border-line md:mt-28">
      <div class="shell flex flex-col gap-6 py-6 md:flex-row md:items-center md:gap-10 md:py-8">
        <span class="label shrink-0 text-slate">Powered by</span>

        {/* Phones: a static wrapped list — nothing scrolls under a thumb. */}
        <ul class="flex flex-wrap items-center gap-x-7 gap-y-5 md:hidden">
          {LOGOS.map((logo) => (
            <LogoItem key={logo.name} logo={logo} muted={false} scale={false} />
          ))}
        </ul>

        {/* Tablet and up: the same set, scaled up and running. */}
        <div class="relative hidden min-w-0 flex-1 overflow-hidden mask-[linear-gradient(to_right,transparent,#000_5%,#000_93%,transparent)] md:block">
          <ul class="marquee flex w-max items-center gap-x-14 lg:gap-x-20">
            {Array.from({ length: MARQUEE_COPIES }, (_, copy) =>
              LOGOS.map((logo) => (
                <LogoItem key={`${copy}:${logo.name}`} logo={logo} muted={copy > 0} scale />
              )),
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

export type Logo = {
  src: string;
  name: string;
  /** Lockups already carry the name; marks get one set beside them. */
  lockup?: boolean;
  /**
   * The mark carries meaningful light areas — an opaque background (Pyth), or
   * white cut-outs inside it (Arbitrum). Invisible on white, so it never
   * mattered until the marks were knocked out to white on a dark plate, where
   * flattening every tone turns the logo into a solid blob. Those invert,
   * greyscale and `mix-blend-screen` instead.
   */
  tonal?: boolean;
  /** Sizing, since each file frames its artwork differently. */
  class?: string;
};

/**
 * The third-party marks rendered by the "Powered by" section in
 * `components/landing/sections.tsx` — the one consumer, so a mark added here
 * appears there and nowhere else.
 */
export const LOGOS: Logo[] = [
  // { src: "/images/logos/tempo.svg", name: "Tempo", lockup: true, class: "h-4 md:h-[1.35rem]" },
  // { src: "/images/logos/solana.svg", name: "Solana", lockup: true, class: "h-4 md:h-[1.35rem]" },
  // { src: "/images/logos/polygon.svg", name: "Polygon", lockup: true, class: "h-6 md:h-[2rem]" },
  // ethereum.org's own landscape lockup, cropped from its 1920x1080 canvas to
  // the artwork — uncropped it renders a few pixels tall at any usable height.
  {
    src: "/images/logos/ethereum.svg",
    name: "Ethereum",
    lockup: true,
    class: "h-6 md:h-[1.75rem]",
  },
  { src: "/images/logos/base.svg", name: "Base", lockup: true, class: "h-4 md:h-[1.35rem]" },
  {
    src: "/images/logos/arbitrum.svg",
    name: "Arbitrum",
    lockup: true,
    tonal: true,
    class: "h-12 md:h-[4rem]",
  },
  { src: "/images/logos/arc.svg", name: "Arc", lockup: true, class: "h-5 md:h-[1.5rem]" },
  { src: "/images/logos/x402.svg", name: "x402", lockup: true, class: "h-5 md:h-[1.5rem]" },
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
    tonal: true,
    class: "h-8 md:h-[2.5rem]",
  },
  { src: "/images/logos/uniswap.svg", name: "Uniswap", lockup: true, class: "h-8 md:h-[3rem]" },
  { src: "/images/logos/0x.svg", name: "0x Protocol", lockup: true, class: "h-4 md:h-[1.35rem]" },
  {
    src: "/images/logos/alchemy.svg",
    name: "Alchemy",
    lockup: true,
    class: "h-5 md:h-[1.5rem]",
  },
  { src: "/images/logos/viem.svg", name: "viem", lockup: true, class: "h-4 md:h-[1.25rem]" },
  { src: "/images/logos/turnkey.svg", name: "Turnkey", lockup: true, class: "h-5 md:h-[1.5rem]" },
  {
    src: "/images/logos/safe-wallet.svg",
    name: "Safe{Wallet}",
    lockup: true,
    class: "h-8 md:h-[2.5rem]",
  },
];

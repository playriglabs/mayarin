import { type AssetCode, assetSymbol } from "@mayarin/shared";
import { useEffect, useId, useRef } from "preact/hooks";

/**
 * The five currencies a merchant can price in, taken from the asset registry
 * rather than typed out — the hero cannot advertise a currency the product
 * does not carry, and `S$` and `RM` are the registry's real symbols.
 */
const ORBITS = [
  {
    path: "M 40 590 A 560 530 0 1 1 1160 590 A 560 530 0 1 1 40 590",
    className: "stroke-forest/70",
    duration: "34s",
    payments: [
      { code: "IDR", begin: "-3s", x: 124, y: 312 },
      { code: "SGD", begin: "-15s", x: 1076, y: 312 },
    ],
  },
  {
    path: "M 410 590 A 190 570 0 1 1 790 590 A 190 570 0 1 1 410 590",
    className: "stroke-slate/45",
    duration: "42s",
    payments: [{ code: "THB", begin: "-10s", x: 600, y: 20 }],
  },
  {
    path: "M 75 590 A 525 205 0 1 1 1125 590 A 525 205 0 1 1 75 590",
    className: "stroke-forest/50",
    duration: "30s",
    payments: [
      { code: "MYR", begin: "-5s", x: 338, y: 412 },
      { code: "USD", begin: "-19s", x: 862, y: 768 },
    ],
  },
] as const;

function Currency({ code }: { readonly code: AssetCode }) {
  const symbol = assetSymbol(code) ?? code;
  return (
    <>
      <circle r="12" class="fill-v2-mist stroke-forest/35" stroke-width="1" />
      <text
        text-anchor="middle"
        dominant-baseline="central"
        // Two-character symbols would otherwise touch the disc's edge.
        class={`fill-forest/80 font-sans font-normal ${symbol.length > 1 ? "text-[10px]" : "text-[12px]"}`}
      >
        {symbol}
      </text>
    </>
  );
}

/** Native SVG motion keeps each currency upright as it follows its payment orbit. */
export function PaymentOrbits() {
  const ref = useRef<SVGSVGElement>(null);
  const id = useId();

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    const syncPlayback = () => {
      if (reducedMotion.matches || !visible || document.hidden) svg.pauseAnimations();
      else svg.unpauseAnimations();
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      syncPlayback();
    });
    observer.observe(svg);
    reducedMotion.addEventListener("change", syncPlayback);
    document.addEventListener("visibilitychange", syncPlayback);
    syncPlayback();
    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener("change", syncPlayback);
      document.removeEventListener("visibilitychange", syncPlayback);
    };
  }, []);

  return (
    <svg
      ref={ref}
      viewBox="0 0 1200 1160"
      fill="none"
      aria-hidden="true"
      focusable="false"
      class="pointer-events-none absolute left-1/2 top-[-22%] w-[145%] max-w-none -translate-x-1/2 overflow-visible md:top-[-38%] md:w-[135%]"
    >
      {ORBITS.map((orbit, index) => (
        <g key={orbit.path}>
          <path
            id={`${id}-orbit-${index}`}
            d={orbit.path}
            class={orbit.className}
            stroke-width="1.25"
            stroke-dasharray="4 5"
            vector-effect="non-scaling-stroke"
          />
          {orbit.payments.map((payment) => (
            <g key={payment.code}>
              <g class="motion-reduce:hidden">
                <animateMotion
                  dur={orbit.duration}
                  begin={payment.begin}
                  repeatCount="indefinite"
                  calcMode="paced"
                >
                  <mpath href={`#${id}-orbit-${index}`} />
                </animateMotion>
                <Currency code={payment.code} />
              </g>
              <g
                class="hidden motion-reduce:block"
                transform={`translate(${payment.x} ${payment.y})`}
              >
                <Currency code={payment.code} />
              </g>
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
}

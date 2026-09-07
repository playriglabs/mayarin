import { assetLogoUrl, assetSymbol } from "@mayarin/shared";
import type { City } from "../globe.tsx";
import { Globe } from "../globe.tsx";
import { Reveal } from "../reveal.tsx";
import { NetworkMarks } from "./network-marks.tsx";

/**
 * One marker per country a merchant can price in — the fiat entries in
 * `packages/shared/src/asset.ts`, nothing else. These are not a corridor, so
 * the globe draws the stops without the line between them.
 *
 * Module-level on purpose: `Globe` takes this as an effect dependency, and a
 * fresh array each render would rebuild the WebGL context every render.
 */
const PRICED_IN: readonly City[] = [
  { id: "indonesia", label: "Indonesia", location: [-6.2088, 106.8456] },
  { id: "singapore", label: "Singapore", location: [1.3521, 103.8198] },
  { id: "malaysia", label: "Malaysia", location: [3.139, 101.6869] },
  { id: "thailand", label: "Thailand", location: [13.7563, 100.5018] },
  { id: "united-states", label: "United States", location: [38.9072, -77.0369] },
];

/** The symbols come from the registry, so a mark can never disagree with its code. */
const CURRENCIES = [
  { name: "Indonesia", code: "IDR", detail: "Rupiah · IDR" },
  { name: "Singapore", code: "SGD", detail: "Dollar · SGD" },
  { name: "Malaysia", code: "MYR", detail: "Ringgit · MYR" },
  { name: "Thailand", code: "THB", detail: "Baht · THB" },
  { name: "United States", code: "USD", detail: "Dollar · USD" },
] as const;

export function Reach() {
  return (
    <section id="reach" class="mx-auto w-full max-w-300 px-6 py-20 md:px-10 md:py-28">
      <Reveal class="mx-auto max-w-155 text-center">
        <h2>
          <span class="text-forest">One clearing layer.</span>
          <br />
          Wherever the payer is.
        </h2>
      </Reveal>

      {/* The globe is the middle column from `lg` up and stacks below it: two
          narrow lists either side of a sphere stop being readable long before
          the sphere stops being worth showing. */}
      <div class="mt-14 grid items-center gap-10 md:mt-16 lg:grid-cols-[1fr_1.6fr_1fr] lg:gap-8">
        <div>
          <p class="text-sm text-slate">Priced in</p>
          <ul class="mt-7 space-y-6">
            {CURRENCIES.map((item) => (
              <li key={item.name}>
                <strong class="block text-base font-medium">{item.name}</strong>
                <span class="mt-1 block text-xs text-slate">
                  {item.detail} ({assetSymbol(item.code)})
                </span>
              </li>
            ))}
          </ul>
        </div>

        <Globe
          class="mx-auto max-w-140"
          cities={PRICED_IN}
          connect={false}
          description="Rotating globe marking the countries a merchant can price in: Indonesia, Singapore, Malaysia, Thailand and the United States."
        />

        <div>
          <p class="text-sm text-slate">Settled in</p>

          {/* One line, wrapping as a whole: the asset, then the networks it can
              land on. The marks carry their own overlap, so the row's gap is
              the only spacing they need. */}
          <div class="mt-7 flex flex-wrap items-center gap-x-2.5 gap-y-3">
            <img
              src={assetLogoUrl("USDC")}
              alt=""
              aria-hidden="true"
              width="26"
              height="26"
              loading="lazy"
              decoding="async"
              class="size-6.5 shrink-0 rounded-full object-contain"
            />
            <strong class="text-base font-medium">USDC</strong>
            <span class="text-xs text-slate">On</span>
            <NetworkMarks ring="ring-paper" />
          </div>

          <p class="mt-3 text-xs text-slate">
            Whatever the payer brought, converted as part of the payment
          </p>
        </div>
      </div>
    </section>
  );
}

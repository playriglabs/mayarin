import type { AssetCode } from "@mayarin/shared";
import { assetLogoUrl, assetSymbol, getAsset } from "@mayarin/shared";
import type { City } from "../globe.tsx";
import { Globe } from "../globe.tsx";
import { Reveal } from "../reveal.tsx";
import { CURRENCY_MARKETS, type CurrencyRegion } from "./currency-markets.ts";
import { MarkStack, NETWORKS } from "./network-marks.tsx";
import { PaymentMethodIcon, type PaymentMethodKind } from "./payment-method-icon.tsx";

/**
 * Regional markers keep the globe legible as currency coverage grows. They
 * summarize the registry's markets; the list beside the globe carries the
 * country-level detail. Kept at module scope because `Globe` uses the array as
 * an effect dependency.
 */
const REGION_MARKERS = {
  "Southeast Asia": { id: "southeast-asia", label: "SOUTHEAST ASIA", location: [10.8, 106] },
  "East Asia": { id: "east-asia", label: "EAST ASIA", location: [35.7, 139.7] },
  Europe: { id: "europe", label: "EUROPE", location: [50.1, 8.7] },
  "North America": { id: "north-america", label: "N. AMERICA", location: [42, -92] },
  APAC: { id: "apac", label: "APAC", location: [-25.3, 133.8] },
  "Middle East": { id: "middle-east", label: "MIDDLE EAST", location: [25.2, 51.5] },
  "Latin America": { id: "latin-america", label: "LATAM", location: [-15.8, -55] },
} as const satisfies Readonly<Record<CurrencyRegion, City>>;

const PAID_WITH: readonly { readonly name: string; readonly kind: PaymentMethodKind }[] = [
  { name: "Bank transfer", kind: "bank" },
  { name: "E-wallets", kind: "wallet" },
  { name: "QR payments", kind: "qr" },
  { name: "Online banking", kind: "online" },
  { name: "Crypto", kind: "crypto" },
];

const PRICED_IN_REGIONS: readonly City[] = Object.values(REGION_MARKERS);

const FEATURED_CURRENCY_CODES: readonly AssetCode[] = ["SGD", "MYR", "THB", "PHP", "USD"];

const FEATURED_CURRENCIES = CURRENCY_MARKETS.filter(({ code }) =>
  FEATURED_CURRENCY_CODES.includes(code),
).map((currency) => ({
  ...currency,
  detail: getAsset(currency.code).name.split(" ").at(-1) ?? currency.code,
}));

/** The stablecoins a merchant can choose to settle in; which one is offered depends on the chain. */
const SETTLEMENT_MARKS = (
  ["USDC", "USDT", "EURC", "PYUSD"] as const satisfies readonly AssetCode[]
).map((code) => ({ name: `${code} · ${getAsset(code).name}`, src: assetLogoUrl(code) }));

const OTHER_CURRENCY_COUNT = CURRENCY_MARKETS.length - FEATURED_CURRENCIES.length;

export function Reach() {
  return (
    <section id="reach" class="mx-auto w-full max-w-300 px-5 py-20 md:px-10 md:py-28">
      <Reveal class="mx-auto max-w-155 text-center">
        <h2>
          <span class="text-forest">One clearing layer.</span>
          <br />
          Wherever the payer is.
        </h2>
      </Reveal>

      <div class="mt-14 grid items-center gap-10 md:mt-16 md:grid-cols-[0.8fr_1.2fr] lg:grid-cols-[1fr_1.6fr_1fr] lg:gap-8">
        <Reveal>
          <p class="text-sm text-slate-600">Priced in</p>
          <ul class="mt-7 grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-1">
            {FEATURED_CURRENCIES.map(({ code, detail, market }) => (
              <li key={code}>
                <strong class="block text-base font-medium">{market}</strong>
                <span class="mt-1 block text-xs text-slate-600">
                  {detail} · {code} ({assetSymbol(code)})
                </span>
              </li>
            ))}
            <li class="col-span-2 flex items-center gap-2 text-slate-600 md:col-span-1">
              <span aria-hidden="true" class="text-xl leading-none">
                +
              </span>
              <strong class="text-base font-medium">Other currencies</strong>
              <span class="sr-only">({OTHER_CURRENCY_COUNT} additional supported currencies)</span>
            </li>
          </ul>
        </Reveal>

        <Globe
          class="mx-auto max-w-140"
          cities={PRICED_IN_REGIONS}
          connect={false}
          description={`Rotating globe marking Southeast Asia, East Asia, Europe, North America, APAC, the Middle East, and Latin America, the regions represented by ${CURRENCY_MARKETS.length} supported pricing currencies.`}
        />

        <Reveal class="md:col-span-2 lg:col-span-1">
          <p class="text-sm text-slate-600">Paid with</p>
          <ul class="mt-4 flex flex-wrap gap-2 text-xs">
            {PAID_WITH.map((method) => (
              <li
                key={method.name}
                class="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5"
              >
                <PaymentMethodIcon kind={method.kind} class="size-3.5 text-forest" />
                {method.name}
              </li>
            ))}
          </ul>

          <p class="mt-9 text-sm text-slate-600">Settled in</p>
          <div class="mt-7 flex flex-wrap items-center gap-x-2.5 gap-y-3">
            <MarkStack marks={SETTLEMENT_MARKS} label="Settlement stablecoins" ring="ring-paper" />
            <span class="text-xs text-slate-600">on</span>
            <MarkStack marks={NETWORKS} label="Networks" ring="ring-paper" />
          </div>

          <p class="mt-5 max-w-70 text-xs leading-relaxed text-slate-600">
            Whatever the payer brought, converted as part of the payment
          </p>
        </Reveal>
      </div>
    </section>
  );
}

import { assetSymbol } from "@mayarin/shared";
import { Reveal } from "../reveal.tsx";
import { NetworkMarks } from "./network-marks.tsx";

/**
 * The symbols come from the asset registry rather than being typed out here, so
 * the page cannot show a currency Mayarin does not price in — or the wrong mark
 * for one it does.
 */
const CURRENCIES = ["IDR", "USD", "SGD", "THB", "MYR"] as const;

function CurrencyMarks() {
  return (
    <div class="mt-4 flex items-center justify-center -space-x-2">
      {CURRENCIES.map((code) => (
        <span
          key={code}
          title={code}
          class="flex size-6.5 shrink-0 items-center justify-center rounded-full bg-v2-sage text-[11px] font-medium text-forest ring-2 ring-v2-mist"
        >
          <span class="sr-only">{code}</span>
          <span aria-hidden="true">{assetSymbol(code)}</span>
        </span>
      ))}
      <span
        aria-hidden="true"
        class="flex size-6.5 shrink-0 items-center justify-center rounded-full bg-v2-sage text-[11px] font-medium text-forest ring-2 ring-v2-mist"
      >
        +
      </span>
    </div>
  );
}

/**
 * Deliberately not traffic. Mayarin runs on testnet, so volume, merchant counts
 * and market coverage would all be invented — these are properties of the
 * system instead, and every one is a constant or a measurement somebody can
 * open:
 *
 *   4      distinct networks in `CHAIN_IDS` (six ids, mainnet + testnet pairs)
 *   5      fiat entries in `packages/shared/src/asset.ts`
 *   3      `EXECUTION_PATHS` in `packages/core/payment-intent/src/types.ts`
 *   0.52s  Arc block time, measured over 1000 blocks — see ROADMAP.md
 */
const FACTS = [
  {
    value: "4+",
    label: "networks a payment can arrive on",
    marks: true,
  },
  {
    value: "5+",
    label: "local currencies to price in",
    currencies: true,
  },
  {
    value: "3",
    label: "execution paths, chosen per payment",
    detail: "Contract · Deposit · x402",
  },
  {
    value: "0.52s",
    label: "Arc block time, measured over 1,000 blocks",
    detail: "",
  },
] as const;

export function Facts() {
  return (
    <section id="facts" class="bg-v2-mist/60 py-20 md:py-28">
      <div class="mx-auto w-full max-w-300 px-6 md:px-10">
        <Reveal class="mx-auto max-w-155 text-center">
          <h2>
            Countless currencies.
            <br />
            <span class="text-forest">No borders to cross.</span>
          </h2>
        </Reveal>

        <div class="mx-auto mt-16 grid max-w-225 gap-14 sm:grid-cols-2 md:mt-20 md:gap-16">
          {FACTS.map((fact, index) => (
            <Reveal key={fact.label} delay={index * 90} class="text-center">
              <strong class="block font-sans text-[clamp(3.5rem,7vw,5.5rem)] leading-[0.95] font-light tracking-[-0.04em] text-forest">
                {fact.value}
              </strong>
              <p class="mx-auto mt-5 max-w-[26ch] text-sm leading-relaxed text-slate">
                {fact.label}
              </p>
              {"marks" in fact ? (
                <NetworkMarks class="mt-4 justify-center" />
              ) : "currencies" in fact ? (
                <CurrencyMarks />
              ) : (
                <p class="text-sm mt-3 text-slate/70">{fact.detail}</p>
              )}
            </Reveal>
          ))}
        </div>

        <p class="mt-16 text-center text-xs text-slate">
          Running on testnet today — so these are facts about the system, not about its traffic.
        </p>
      </div>
    </section>
  );
}

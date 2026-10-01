import { RailMark } from "./rail-mark.tsx";
import { Check } from "./ui.tsx";

const RAILS = [
  { asset: "EURC", chain: "base", label: "Base" },
  { asset: "USDG", chain: "arbitrum", label: "Arbitrum" },
  { asset: "ETH", chain: "base", label: "Base" },
  { asset: "PYUSD", chain: "ethereum", label: "Ethereum" },
] as const;

const BENEFITS = [
  {
    title: "Your prices, in local currency.",
    description:
      "Keep prices in the currency your business uses. Mayarin handles the quote and conversion so customers know what to pay.",
  },
  {
    title: "More ways to fund a payment.",
    description:
      "Let customers choose from supported assets and networks at checkout. One payment link brings those options together.",
  },
  {
    title: "Stablecoin settlement, in your wallet.",
    description:
      "Receive stablecoins in your own wallet and follow each payment from checkout to settlement, with a clear record in your dashboard.",
  },
] as const;

export function PaymentReach() {
  return (
    <section
      id="payment-reach"
      aria-labelledby="payment-reach-title"
      class="mx-auto w-full max-w-300 px-6 py-20 md:px-10 md:py-28"
    >
      <h2
        id="payment-reach-title"
        class="max-w-225 text-pretty font-medium text-[clamp(1.5rem,2.5vw,2rem)]! leading-tight!"
      >
        Reach more customers.{" "}
        <span class="text-slate-600">Let them pay their way, while you get paid yours.</span>
      </h2>

      <div class="relative isolate mt-10 overflow-hidden rounded-2xl bg-linear-to-br from-v2-mist via-v2-sage to-forest px-5 py-10 sm:px-10 md:mt-14 md:px-16 md:py-16">
        <div
          aria-hidden="true"
          class="pointer-events-none absolute -right-20 -top-40 -z-10 size-150 rounded-full border-60 border-paper/15"
        />
        <div class="relative mx-auto grid max-w-210 items-center gap-5 md:grid-cols-2 md:gap-0">
          <div class="rounded-2xl border border-line bg-paper p-6 shadow-lg shadow-forest/5 md:p-8">
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm font-semibold">Mayarin checkout</span>
            </div>
            <p class="mt-7 text-xs text-slate-600">Order total</p>
            <p class="mt-2 font-heading text-3xl font-medium tracking-tight">50 $S</p>
            <div class="mt-5 flex items-center justify-between rounded-lg border border-line px-4 py-3 text-sm">
              <span class="text-slate-600">Pricing currency</span>
              <span class="font-medium">SGD</span>
            </div>
            <p class="mb-3 mt-6 text-xs text-slate-600">Choose how to pay</p>
            <div class="grid grid-cols-2 gap-3">
              {RAILS.map((rail, index) => (
                <div
                  key={`${rail.asset}-${rail.chain}`}
                  class={`flex items-center gap-3 rounded-lg border p-3 ${index === 0 ? "border-forest bg-v2-mist" : "border-line"}`}
                >
                  <RailMark asset={rail.asset} chain={rail.chain} size={28} />
                  <div>
                    <p class="text-xs font-semibold">{rail.asset}</p>
                    <p class="mt-px text-[11px] text-slate-600">{rail.label}</p>
                  </div>
                </div>
              ))}
            </div>
            <div class="mt-6 rounded-lg bg-forest px-4 py-3 text-center text-sm font-medium text-paper">
              Pay with EURC
            </div>
          </div>

          <div class="relative rounded-2xl border border-line bg-paper p-6 shadow-xl shadow-forest/10 md:-ml-6 md:translate-y-8 md:p-8">
            <div class="flex size-10 items-center justify-center rounded-full bg-v2-sage text-forest">
              <Check />
            </div>
            <p class="mt-5 text-lg font-semibold tracking-tight">Your sale. Settled.</p>
            <p class="mt-2 text-sm leading-relaxed text-slate-600">
              Local-currency pricing to stablecoins in your wallet.
            </p>
            <dl class="mt-6 space-y-4 text-sm">
              {[
                ["Customer paid", "EURC on Base"],
                ["You receive", "USDC"],
                ["Destination", "Your wallet"],
                ["Payment status", "Settled"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  class="flex justify-between gap-4 border-b border-line pb-4 last:border-0 last:pb-0"
                >
                  <dt class="text-slate-600">{label}</dt>
                  <dd class="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>

      <div class="mt-8 grid gap-6 text-sm leading-relaxed text-slate-600 md:mt-10 md:grid-cols-3 md:gap-8 md:text-base">
        {BENEFITS.map((benefit) => (
          <p key={benefit.title}>
            <strong class="font-semibold text-ink">{benefit.title}</strong> {benefit.description}
          </p>
        ))}
      </div>
    </section>
  );
}

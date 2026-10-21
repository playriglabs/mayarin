import { assetLogoUrl } from "@mayarin/shared";
import { PaymentMethodIcon } from "./payment-method-icon.tsx";
import { Check } from "./ui.tsx";

const LOCAL_METHODS = [
  { name: "Bank transfer", kind: "bank" },
  { name: "E-wallet", kind: "wallet" },
  { name: "QR payment", kind: "qr" },
  { name: "Online banking", kind: "online" },
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
      "Let customers pay with local methods like bank transfer and e-wallets, or with supported crypto assets and networks. One payment link brings those options together.",
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

      <div class="relative isolate -mx-6 mt-10 overflow-hidden bg-linear-to-br from-v2-mist via-v2-sky to-brand px-5 py-10 sm:mx-0 sm:rounded-2xl sm:px-10 md:mt-14 md:px-16 md:py-16">
        <div
          aria-hidden="true"
          class="pointer-events-none absolute -right-20 -top-40 -z-10 size-150 rounded-full border-60 border-paper/15"
        />
        <div class="relative mx-auto grid max-w-210 items-center gap-5 md:grid-cols-2 md:gap-0">
          <div class="rounded-2xl border border-line bg-paper p-6 shadow-lg shadow-brand/5 md:p-8">
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm font-semibold">Mayarin checkout</span>
            </div>
            <p class="mt-7 text-xs text-slate-600">Order total</p>
            <p class="mt-2 font-heading text-3xl font-medium tracking-tight">RM 50.00</p>
            <div class="mt-5 grid grid-cols-2 gap-2 rounded-lg bg-v2-mist p-1 text-center text-xs font-medium">
              <span class="rounded-md py-2 text-slate-600">Crypto</span>
              <span class="rounded-md bg-paper py-2 shadow-sm">Local currency</span>
            </div>
            <p class="mb-3 mt-6 text-xs text-slate-600">Choose how to pay</p>
            <div class="grid grid-cols-2 gap-3">
              {LOCAL_METHODS.map((method, index) => (
                <div
                  key={method.name}
                  class={`flex items-center gap-2.5 rounded-lg border px-3 py-4 ${index === 0 ? "border-brand bg-v2-mist" : "border-line"}`}
                >
                  <PaymentMethodIcon kind={method.kind} class="size-5 shrink-0 text-brand" />
                  <p class="text-xs font-semibold">{method.name}</p>
                </div>
              ))}
            </div>
            <div class="mt-6 rounded-lg bg-brand px-4 py-3 text-center text-sm font-medium text-paper">
              Pay with bank transfer
            </div>
          </div>

          <div class="relative rounded-2xl border border-line bg-paper p-6 shadow-xl shadow-brand/10 md:-ml-6 md:translate-y-8 md:p-8">
            <div class="flex size-10 items-center justify-center rounded-full bg-v2-sky text-brand">
              <Check />
            </div>
            <p class="mt-5 text-lg font-semibold tracking-tight">Your sale. Settled.</p>
            <p class="mt-2 text-sm leading-relaxed text-slate-600">
              Local-currency pricing to stablecoins in your wallet.
            </p>
            <dl class="mt-6 space-y-4 text-sm">
              {[
                ["Customer paid", "Bank transfer"],
                ["You receive", "USDC"],
                ["Destination", "Your wallet"],
                ["Payment status", "Settled"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  class="flex justify-between gap-4 border-b border-line pb-4 last:border-0 last:pb-0"
                >
                  <dt class="text-slate-600">{label}</dt>
                  <dd class="flex items-center gap-2 font-medium">
                    {value === "USDC" && (
                      <img
                        src={assetLogoUrl("USDC")}
                        alt=""
                        width={20}
                        height={20}
                        loading="lazy"
                        decoding="async"
                        class="size-5 shrink-0 rounded-full"
                      />
                    )}
                    {value}
                  </dd>
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

import { Reveal } from "../reveal.tsx";
import { PaymentOrbits } from "./payment-orbits.tsx";
import { ScrollTilt } from "./scroll-tilt.tsx";
import { Action, Check, DashboardPreview } from "./ui.tsx";

export function Hero() {
  return (
    <section class="relative isolate overflow-hidden bg-v2-mist pt-28 sm:pt-32 md:pt-44 [&_h1]:mt-7 [&_h1]:text-[clamp(2.7rem,7.5vw,4.5rem)] [&_h1]:leading-[1.1] md:[&_h1]:leading-[1.04] [&_h1_span]:text-forest">
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-1/2 bg-linear-to-t from-v2-sage/80 to-transparent"
      />
      <div class="mx-auto w-full max-w-300 px-6 md:px-10 text-center">
        <div class="relative z-20">
          <Reveal>
            <h1>
              Your business. <br class="hidden sm:block" />A world of <span>ways to pay.</span>
            </h1>
          </Reveal>
          <Reveal delay={120}>
            <p class="mx-auto mt-7 max-w-165 text-base leading-relaxed text-slate-600 md:text-[17px]">
              Payments infrastructure for the borderless economy.
              <br class="hidden md:block" /> One integration: local-currency pricing, customers who
              pay with bank transfer, e-wallets or crypto, and stablecoin settlement.
            </p>
          </Reveal>
          <Reveal delay={240} class="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href="#use-cases"
              class="inline-flex min-h-12 shrink-0 items-center justify-center rounded-full bg-forest px-5 py-3 text-sm font-medium text-paper ring-1 ring-inset ring-forest transition-colors duration-200 hover:bg-paper hover:text-ink hover:ring-line focus-visible:outline-ink sm:px-6"
            >
              See the use cases
            </a>
            <Action href="#footer-early-access">Get early access</Action>
          </Reveal>
        </div>
        <div class="relative z-0 isolate mx-auto mt-14 max-w-255 px-1 pt-3 md:mt-24 md:max-w-290 md:px-4">
          <PaymentOrbits />
          <ScrollTilt>
            <DashboardPreview src="/images/product/mayarin-overview.png" />
          </ScrollTilt>
        </div>
      </div>
    </section>
  );
}

export function ValueStrip() {
  return (
    <div class="grid gap-5 border-b border-line py-8 text-xs text-slate-600 md:grid-cols-3 md:gap-8 [&_p]:flex [&_p]:items-center [&_p]:justify-center [&_p]:gap-2 [&_svg]:shrink-0 [&_svg]:text-forest mx-auto w-full max-w-300 px-6 md:px-10">
      {[
        "Your prices, in local currency",
        "Your customers, paying their way",
        "Your payments, in one place",
      ].map((text, index) => (
        <Reveal as="p" class="text-sm" key={text} delay={index * 90}>
          <Check />
          {text}
        </Reveal>
      ))}
    </div>
  );
}

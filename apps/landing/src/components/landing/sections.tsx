import clsx from "clsx";
import { LOGOS } from "../powered-by.tsx";
import { Reveal } from "../reveal.tsx";
import { PaymentOrbits } from "./payment-orbits.tsx";
import { ScrollTilt } from "./scroll-tilt.tsx";
import { Action, Check, DashboardPreview } from "./ui.tsx";

export function Hero() {
  return (
    <section class="relative isolate overflow-hidden bg-v2-mist pt-28 sm:pt-32 md:pt-44 [&_h1]:mt-7 [&_h1]:text-[clamp(2.7rem,7.5vw,5rem)] [&_h1]:leading-[1.1] md:[&_h1]:leading-[1.04] [&_h1_span]:text-forest">
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
            <p class="mx-auto mt-7 max-w-155 text-base leading-relaxed text-slate-600 md:text-[17px]">
              Accept crypto. Price in your local currency. Get paid in stablecoins.
              <br class="hidden md:block" /> All the tools to bring your next sale closer.
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
            <DashboardPreview src="/images/pitch-deck/mayarin-analytics.png" />
          </ScrollTilt>
        </div>
      </div>
    </section>
  );
}

export function PoweredBy() {
  return (
    <section
      id="powered-by"
      class="py-20 md:py-28 bg-plate text-paper [&_h2]:text-paper [&_p]:text-white/65"
    >
      <div class="mx-auto w-full max-w-300 px-6 md:px-10">
        {/* Wide enough to hold "Every provider is temporary." on one line at the
            h2's largest clamp; the lede keeps its own narrower measure. */}
        <Reveal class="mx-auto max-w-225 text-center">
          <p class="text-sm mb-5 text-accent">Powered by</p>
          <h2 class="text-balance">
            Providers are temporary.
            <br />
            <span class="text-accent">The clearing layer is not.</span>
          </h2>
          <p class="mx-auto mt-6 max-w-[52ch] text-base leading-relaxed">
            Chains, oracles, venues and custody each sit behind a port. Swap any one of them and the
            payment logic never learns that anything changed.
          </p>
        </Reveal>

        {/* The marks are dark lockups, so the plate knocks them out to white
            rather than greying them the way the light strip does.

            A mark with meaningful light areas cannot be knocked out that way:
            flattening every tone to black loses its background or its cut-outs
            and leaves a blob. Inverting turns those lights black and greyscale
            drops the colour shift inverting introduces, then `screen` drops the
            blacks against the plate. */}
        <Reveal delay={120}>
          <ul class="flex flex-wrap items-center justify-center gap-x-12 gap-y-9 pt-14 md:gap-x-16 md:pt-16">
            {LOGOS.map((logo) => (
              <li
                key={logo.name}
                class={clsx(
                  "flex shrink-0 items-center gap-2.5 opacity-70 transition-opacity duration-300 hover:opacity-100",
                  logo.tonal ? "mix-blend-screen invert grayscale" : "brightness-0 invert",
                )}
              >
                <img
                  src={logo.src}
                  alt={logo.lockup ? logo.name : ""}
                  loading="lazy"
                  decoding="async"
                  class={clsx("w-auto", logo.class ?? "h-7 md:h-8")}
                />
                {logo.lockup ? null : (
                  <span class="whitespace-nowrap font-sans text-base font-bold text-paper lowercase">
                    {logo.name}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Reveal>
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

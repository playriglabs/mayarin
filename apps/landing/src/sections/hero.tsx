import { PoweredBy } from "../components/powered-by.tsx";
import { Reveal } from "../components/reveal.tsx";
import { ArrowRight } from "../components/ui.tsx";
import { WaveGrid } from "../graphics/wave-grid.tsx";

export function Hero() {
  return (
    <section id="top" class="relative overflow-hidden bg-paper pt-28 pb-0 md:pt-36">
      <WaveGrid />

      <div class="shell relative flex flex-col items-center text-center">
        <Reveal>
          <p class="label inline-flex items-center gap-2.5 rounded-full border border-line px-4 py-2 text-[0.625rem] tracking-[0.14em] whitespace-nowrap text-slate sm:text-[0.6875rem] sm:tracking-[0.18em]">
            <span aria-hidden="true" class="inline-block size-1.5 rounded-full bg-accent" />
            Programmable clearing infrastructure
          </p>
        </Reveal>

        <Reveal delay={80}>
          <h1 class="mt-10 max-w-[16ch] text-[clamp(2.75rem,7vw,6.5rem)] leading-[0.98]">
            Clearing infrastructure for money <em class="italic">in motion</em>.
          </h1>
        </Reveal>

        <Reveal delay={160}>
          <p class="mt-8 max-w-[62ch] text-lg leading-[1.6] text-slate">
            One integration moves value across digital assets, banks and local payment rails.
          </p>
        </Reveal>

        <Reveal delay={240} class="mt-10 flex items-center gap-3">
          <a
            href="#start"
            class="label inline-flex h-14 cursor-pointer items-center rounded-full bg-ink px-8 text-white transition-colors duration-200 hover:bg-forest"
          >
            Start building
          </a>
          <a
            href="#start"
            aria-label="Start building"
            class="inline-flex size-14 cursor-pointer items-center justify-center rounded-full border border-black/20 text-ink transition-colors duration-200 hover:border-ink"
          >
            <ArrowRight width="16" height="16" />
          </a>
        </Reveal>

        <Reveal delay={300}>
          <a
            href="#developers"
            class="label mt-10 inline-flex items-center gap-2 text-slate transition-colors duration-200 hover:text-ink"
          >
            Read the documentation
            <ArrowRight width="12" height="12" />
          </a>
        </Reveal>
      </div>

      <PoweredBy />
    </section>
  );
}

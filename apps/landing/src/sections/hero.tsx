import { PoweredBy } from "../components/powered-by.tsx";
import { Reveal } from "../components/reveal.tsx";
import { ArrowRight } from "../components/ui.tsx";
import { HoverGrid } from "../graphics/hover-grid.tsx";

function DocumentationIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="square"
      aria-hidden="true"
      class="size-3.5 shrink-0"
    >
      <path d="M2 3.5h3.5A2.5 2.5 0 0 1 8 6v7a2.5 2.5 0 0 0-2.5-2.5H2zM14 3.5h-3.5A2.5 2.5 0 0 0 8 6v7a2.5 2.5 0 0 1 2.5-2.5H14z" />
    </svg>
  );
}

export function Hero() {
  return (
    <section id="top" class="relative overflow-hidden bg-paper pt-28 pb-0 md:pt-36">
      <HoverGrid />

      <div class="shell relative flex flex-col items-center text-center">
        <Reveal>
          <p class="label inline-flex items-center gap-2.5 text-[0.625rem] tracking-[0.14em] whitespace-nowrap text-slate sm:text-[0.6875rem] sm:tracking-[0.18em]">
            <span aria-hidden="true" class="inline-block size-1.5 bg-accent" />
            Programmable clearing infrastructure.
          </p>
        </Reveal>

        <Reveal delay={80}>
          <h1 class="mt-10 max-w-[16ch] text-[clamp(2.8rem,7vw,6rem)] leading-[0.98]">
            Clearing infrastructure for money <em class="italic">in motion</em>.
          </h1>
        </Reveal>

        <Reveal delay={160}>
          <p class="mt-8 max-w-[62ch] text-base md:text-lg leading-[1.6] text-slate">
            The fastest way for internet businesses in emerging markets to get paid globally and
            settle locally.
          </p>
        </Reveal>

        <Reveal delay={240} class="mt-10 flex items-center gap-3">
          <a
            href="#developers"
            class="btn-fill [--btn-fill:var(--color-forest)] label inline-flex h-14 text-[11px] cursor-pointer items-center bg-ink px-10 text-white"
          >
            Start building
          </a>
          <a
            href="https://docs.mayarin.xyz"
            aria-label="Start building"
            class="inline-flex size-14 cursor-pointer items-center justify-center border border-black/20 text-ink transition-colors duration-200 hover:border-ink"
          >
            <ArrowRight width="16" height="16" />
          </a>
        </Reveal>

        <Reveal delay={300}>
          <a
            href="https://docs.mayarin.xyz"
            class="label mt-10 inline-flex items-center gap-2 text-slate transition-colors duration-200 hover:text-ink"
          >
            <DocumentationIcon />
            Read the documentation
            <ArrowRight width="12" height="12" />
          </a>
        </Reveal>
      </div>

      <PoweredBy />
    </section>
  );
}

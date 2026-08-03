import { Reveal } from "../components/reveal.tsx";
import { ArrowRight, Button, Label } from "../components/ui.tsx";

export function FinalCta() {
  return (
    <section id="start" class="relative overflow-hidden bg-void text-white">
      <svg
        aria-hidden="true"
        viewBox="0 0 1200 400"
        preserveAspectRatio="none"
        class="pointer-events-none absolute inset-0 h-full w-full"
      >
        {[80, 160, 240, 320].map((y, index) => (
          <g key={y}>
            <path
              d={`M-20 ${y} H420 C540 ${y} 560 200 680 200 H1220`}
              pathLength={196}
              fill="none"
              stroke="rgba(255,255,255,0.2)"
              stroke-width="1.25"
              vector-effect="non-scaling-stroke"
            />
            <path
              d={`M-20 ${y} H420 C540 ${y} 560 200 680 200 H1220`}
              pathLength={196}
              fill="none"
              stroke="var(--color-accent)"
              stroke-width="2"
              vector-effect="non-scaling-stroke"
              class="flow-line"
              style={`--flow-delay:${index * 1.1}s`}
            />
          </g>
        ))}
      </svg>

      <div class="shell relative py-28 md:py-40">
        <Reveal>
          <Label tone="dark">Get started</Label>
        </Reveal>

        <Reveal delay={80}>
          <h2 class="mt-8 max-w-[16ch] text-[clamp(2.5rem,6.4vw,5.5rem)] leading-none">
            Build payment infrastructure once. Move value <em class="italic">anywhere</em>.
          </h2>
        </Reveal>

        <Reveal delay={160} class="mt-12 flex flex-wrap items-center gap-3">
          <Button href="#start" variant="primary-dark">
            Start building
            <ArrowRight />
          </Button>
          <Button href="#developers" variant="secondary-dark">
            Read documentation
          </Button>
        </Reveal>

        <Reveal delay={220}>
          <p class="label mt-10 flex flex-wrap gap-x-6 gap-y-2 text-slate-inverse">
            <span>Sandbox in minutes</span>
            <span aria-hidden="true">·</span>
            <span>No rail rewrite</span>
            <span aria-hidden="true">·</span>
            <span>Provider-agnostic from day one</span>
          </p>
        </Reveal>
      </div>
    </section>
  );
}

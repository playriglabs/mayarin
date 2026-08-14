import { Reveal } from "../components/reveal.tsx";
import { ArrowRight, Button, Label } from "../components/ui.tsx";
import { PixelField } from "../graphics/pixel-field.tsx";

export function FinalCta() {
  return (
    <section id="start" class="relative overflow-hidden bg-void text-white">
      <PixelField />

      <div class="shell pointer-events-none relative z-2 py-28 md:py-40">
        <Reveal>
          <Label tone="dark">Get started</Label>
        </Reveal>

        <Reveal delay={80}>
          <h2 class="mt-8 max-w-[16ch] text-[clamp(2.5rem,6.4vw,5.5rem)] leading-none">
            Build payment infrastructure once. Move value <em class="italic">anywhere</em>.
          </h2>
        </Reveal>

        <Reveal delay={160} class="pointer-events-auto mt-12 flex flex-wrap items-center gap-3">
          <Button href="https://docs.mayarin.xyz" variant="primary-dark">
            Start building
            <ArrowRight />
          </Button>
          <Button href="https://docs.mayarin.xyz" variant="secondary-dark">
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

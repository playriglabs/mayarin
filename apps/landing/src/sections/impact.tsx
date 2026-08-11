import { Globe } from "../components/globe.tsx";
import { Reveal } from "../components/reveal.tsx";
import { Label, Lede, Section, SectionHeading } from "../components/ui.tsx";

/**
 * Properties of the clearing path rather than traction numbers — each one is a
 * claim the codebase can be held to.
 */
const FIGURES = [
  { value: "9", body: "states in the clearing path, every one replayable and auditable." },
  { value: "18", body: "decimals carried end to end, from local currency to an ERC-20 balance." },
  { value: "0", body: "floating-point numbers anywhere a value is calculated." },
];

export function Impact() {
  return (
    <Section id="impact">
      <div class="grid items-center gap-16 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20 xl:gap-28">
        <div>
          <Reveal>
            <Label>Impact</Label>
          </Reveal>

          <Reveal delay={60}>
            <SectionHeading class="max-w-[15ch]">
              Money crosses borders. Your integration doesn't.
            </SectionHeading>
          </Reveal>

          <Reveal delay={120}>
            <Lede class="max-w-[42ch]">
              Assets and chains are the new borders. The clearing path crosses them — adding a chain
              or asset is an adapter, not a rebuild.
            </Lede>
          </Reveal>
        </div>

        <Reveal delay={160}>
          <div class="mx-auto w-full max-w-152">
            <Globe />
          </div>

          <p class="label mt-3 flex items-center justify-center gap-2.5 text-center text-slate leading-5">
            <span aria-hidden="true" class="inline-block size-1.5 shrink-0 bg-accent" />
            One clearing layer, across global markets — drag to spin
          </p>
        </Reveal>
      </div>

      <div class="mt-20 grid gap-px border-y border-line bg-line lg:mt-24 sm:grid-cols-3">
        {FIGURES.map((figure, index) => (
          <div key={figure.value} class="bg-paper">
            <Reveal delay={index * 70} class="h-full px-2 py-8 sm:px-8 md:px-10 md:py-10">
              <p class="font-display text-[3.25rem] leading-none tracking-[-0.02em]">
                {figure.value}
              </p>
              <p class="mt-4 max-w-[30ch] text-sm leading-[1.7] text-slate">{figure.body}</p>
            </Reveal>
          </div>
        ))}
      </div>
    </Section>
  );
}

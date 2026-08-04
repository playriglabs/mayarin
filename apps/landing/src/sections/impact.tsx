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
      <Reveal>
        <Label>Impact</Label>
      </Reveal>

      <div class="md:flex md:items-end md:justify-between md:gap-20">
        <Reveal delay={60}>
          <SectionHeading>Money crosses borders. Your integration doesn't.</SectionHeading>
        </Reveal>
        <Reveal delay={120}>
          <Lede class="md:mb-3 md:max-w-[36ch]">
            Assets and chains are the new borders. The clearing path crosses them — adding a chain
            or asset is an adapter, not a rebuild.
          </Lede>
        </Reveal>
      </div>

      <Reveal delay={160} class="mt-16 md:mt-20">
        <div class="mx-auto w-full max-w-136">
          <Globe />
        </div>

        <p class="label mt-2 flex items-center justify-center gap-2.5 text-slate leading-5">
          <span aria-hidden="true" class="inline-block size-1.5 rounded-full bg-accent" />
          Jakarta outward, through Asia — drag to spin
        </p>
      </Reveal>

      <div class="mt-16 grid gap-px border-y border-line bg-line md:mt-20 sm:grid-cols-3">
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

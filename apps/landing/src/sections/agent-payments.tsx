import { Reveal } from "../components/reveal.tsx";
import { ScrambleText } from "../components/scramble-text.tsx";
import { Label, Lede, Section, SectionHeading } from "../components/ui.tsx";

/**
 * The payer-class widening.
 *
 * The section exists to make one claim and refuse another: what changed is who
 * may pay, and Mayarin has not become an AI product. The dark card carries the
 * refusal, because that is the sentence a reader is most likely to arrive
 * already doubting.
 */

type PayerClass = Readonly<{
  who: string;
  how: string;
  status: string;
}>;

const PAYER_CLASSES: readonly PayerClass[] = [
  {
    who: "Human",
    how: "Connects a wallet, scans a QR, or sends a transfer.",
    status: "Live",
  },
  {
    who: "Application",
    how: "Pays on a person's behalf, or on its own schedule.",
    status: "Live",
  },
  {
    who: "Autonomous agent",
    how: "Signs one authorization per call. No account, no key, no checkout.",
    status: "New",
  },
];

export function AgentPayments() {
  return (
    <Section id="agents">
      <Reveal>
        <Label>Payer classes</Label>
      </Reveal>

      <div class="md:flex md:items-end md:justify-between md:gap-20">
        <Reveal delay={60}>
          <SectionHeading>The thesis did not change. Who may pay did.</SectionHeading>
        </Reveal>
        <Reveal delay={120}>
          <Lede class="md:mb-3 md:max-w-[38ch]">
            One clearing layer, three kinds of payer. A person at a checkout, an application acting
            for them, and now a program that has never registered with anybody.
          </Lede>
        </Reveal>
      </div>

      <div class="mt-12 grid gap-px border-y border-line bg-line md:mt-16 lg:grid-cols-5">
        {/* The dark card states the refusal. It is deliberately the largest
            surface in the section: "the agent is not the product" is the claim
            most readers arrive sceptical of. */}
        <Reveal class="lg:col-span-3">
          <article class="flex h-full flex-col justify-between bg-void px-6 py-10 text-white md:p-12">
            <div>
              <h3 class="max-w-[18ch] text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.1] tracking-[-0.02em]">
                An agent is a payer class, not a product line.
              </h3>
              <p class="mt-6 max-w-[46ch] text-[0.95rem] leading-[1.7] text-slate-inverse">
                It reaches the same clearing engine, writes to the same double-entry ledger, and
                settles to the same merchant as everyone else. What differs is small and specific:
                it cannot open an account, hold a card, or be told to understand gas — so it is
                given exactly one thing to sign.
              </p>
            </div>

            <div class="mt-12" aria-hidden="true">
              {/* ILLUSTRATION SLOT — three payer classes arriving at one clearing layer
                  Drop the generated asset here. Keep `aria-hidden`: the caption and the
                  copy already carry the meaning, so the image is decorative and a screen
                  reader should skip it.
                      <img src="/images/payer-classes.webp" alt="" class="h-auto w-full max-w-104" />
                  The reserved box below keeps the layout from jumping while the slot is
                  empty. Delete it once the image is in. */}
              <div class="aspect-[4/3] w-full max-w-104 border border-line-inverse" />
            </div>
          </article>
        </Reveal>

        <div class="grid gap-px bg-line lg:col-span-2">
          <Reveal delay={80}>
            <article class="h-full bg-paper px-6 py-10 md:p-10">
              <h3 class="text-[1.2rem] tracking-[-0.01em]">
                <ScrambleText text="One thing to sign" trigger="[data-scramble-cell]" />
              </h3>
              <p class="mt-3 max-w-[38ch] text-sm leading-[1.7] text-slate">
                An authorization for an exact amount, in an asset the payer already holds. It never
                touches gas, never holds the merchant's asset, and never sees an address.
              </p>
              <div class="mt-8" aria-hidden="true">
                {/* ILLUSTRATION SLOT — one authorization, signed once
                    Drop the generated asset here. Keep `aria-hidden`: the caption and the
                    copy already carry the meaning, so the image is decorative and a screen
                    reader should skip it.
                        <img src="/images/authorization.webp" alt="" class="h-auto w-full max-w-60" />
                    The reserved box below keeps the layout from jumping while the slot is
                    empty. Delete it once the image is in. */}
                <div class="aspect-square w-full max-w-60 border border-line" />
              </div>
            </article>
          </Reveal>

          <Reveal delay={140}>
            <article class="h-full bg-paper px-6 py-10 md:p-10">
              <h3 class="text-[1.2rem] tracking-[-0.01em]">
                <ScrambleText text="The merchant is unchanged" trigger="[data-scramble-cell]" />
              </h3>
              <p class="mt-3 max-w-[38ch] text-sm leading-[1.7] text-slate">
                Still priced in their own currency. Still paid in their configured stablecoin. A
                merchant does not have to know which of the three paid them, and the books do not
                record it differently.
              </p>
            </article>
          </Reveal>
        </div>
      </div>

      {/* The table is the section's evidence: three rows, one of which is new. */}
      <div class="mt-px grid gap-px border-b border-line bg-line md:grid-cols-3">
        {PAYER_CLASSES.map((payer, index) => (
          <Reveal key={payer.who} delay={index * 70}>
            <div class="flex h-full flex-col gap-3 bg-paper px-6 py-8 md:p-10">
              <div class="flex items-baseline justify-between gap-4">
                <h4 class="text-[1.05rem] tracking-[-0.01em]">{payer.who}</h4>
                <span
                  class={
                    payer.status === "New"
                      ? "label bg-accent px-2 py-0.5 text-void"
                      : "label text-slate"
                  }
                >
                  {payer.status}
                </span>
              </div>
              <p class="max-w-[34ch] text-sm leading-[1.7] text-slate">{payer.how}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

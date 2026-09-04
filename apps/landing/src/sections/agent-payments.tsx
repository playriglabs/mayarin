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

      <div class="-mx-6 mt-12 grid gap-px border-y border-line bg-line md:-mx-10 md:mt-16 min-[1367px]:mx-0">
        {/* The dark card states the refusal. It is deliberately the largest
            surface in the section: "the agent is not the product" is the claim
            most readers arrive sceptical of. */}
        <Reveal>
          <article class="grid items-center gap-12 bg-void px-6 py-10 text-white md:p-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(22rem,1.1fr)] lg:gap-16">
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

            <div class="flex justify-center lg:justify-end" aria-hidden="true">
              <img
                src="/images/payer-classes.webp?v=5"
                alt=""
                width="1248"
                height="566"
                loading="lazy"
                decoding="async"
                class="h-auto w-full max-w-2xl"
              />
            </div>
          </article>
        </Reveal>

        <div class="grid gap-px bg-line lg:grid-cols-2">
          <Reveal delay={80}>
            <article class="grid h-full items-center gap-8 bg-paper px-6 py-10 md:p-10 xl:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)]">
              <div>
                <h3 class="text-[24px] tracking-[-0.01em]">
                  <ScrambleText text="One thing to sign" trigger="[data-scramble-cell]" />
                </h3>
                <p class="mt-3 max-w-[38ch] text-sm leading-[1.7] text-slate">
                  An authorization for an exact amount, in an asset the payer already holds. It
                  never touches gas, never holds the merchant's asset, and never sees an address.
                </p>
              </div>
              <div class="flex justify-center xl:justify-end" aria-hidden="true">
                <img
                  src="/images/authorization-flow.png"
                  alt=""
                  width="1672"
                  height="941"
                  loading="lazy"
                  decoding="async"
                  class="h-auto w-full max-w-72 object-contain"
                />
              </div>
            </article>
          </Reveal>

          <Reveal delay={140}>
            <article class="grid h-full items-center gap-8 bg-paper px-6 py-10 md:p-10 xl:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)]">
              <div>
                <h3 class="text-[24px] tracking-[-0.01em]">
                  <ScrambleText text="The merchant is unchanged" trigger="[data-scramble-cell]" />
                </h3>
                <p class="mt-3 max-w-[38ch] text-sm leading-[1.7] text-slate">
                  Still priced in their own currency. Still paid in their configured stablecoin. A
                  merchant does not have to know which of the three paid them, and the books do not
                  record it differently.
                </p>
              </div>
              <div class="flex justify-center xl:justify-end" aria-hidden="true">
                <img
                  src="/images/merchant-unchanged.webp?v=4"
                  alt=""
                  width="457"
                  height="640"
                  loading="lazy"
                  decoding="async"
                  class="h-72 w-auto max-w-full object-contain"
                />
              </div>
            </article>
          </Reveal>
        </div>
      </div>

      {/* The table is the section's evidence: three rows, one of which is new. */}
      <div class="-mx-6 mt-px grid gap-px border-b border-line bg-line md:-mx-10 md:grid-cols-3 min-[1367px]:mx-0">
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

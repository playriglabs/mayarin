import clsx from "clsx";
import type { ComponentChildren } from "preact";
import { Reveal } from "../components/reveal.tsx";
import { Label, Lede, Section, SectionHeading } from "../components/ui.tsx";

const TRADITIONAL = ["Application", "Payment provider"];

const MAYARIN = [
  "Application",
  "Payment Intent",
  "Clearing Engine",
  "Settlement Layer",
  "Stablecoin payout",
];

const DIFFERENCES = [
  {
    title: "The state lives with you",
    body: "A gateway tells you what happened after the fact. A clearing layer holds the state machine, the events and the postings — so reconciliation is a query, not an investigation.",
  },
  {
    title: "Failure has a shape",
    body: "Errors carry a code and a retryable flag. Retryable steps resume where they stopped; terminal ones fail the payment cleanly. Nothing is left half-settled.",
  },
  {
    title: "Providers stay replaceable",
    body: "Pricing, coverage and regulation move. When the provider sits behind a port, moving to a new one is a configuration change instead of a migration project.",
  },
  {
    title: "A new payer is not a new stack",
    body: "An agent paying per API call reaches the same engine, the same ledger and the same merchant as a person at a checkout. It is a third execution path, not a second product.",
  },
];

function Node({
  children,
  emphasis = false,
  muted = false,
}: {
  children: ComponentChildren;
  emphasis?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      class={clsx(
        "flex h-14 items-center justify-center border px-5 text-center text-sm",
        emphasis
          ? "border-ink bg-ink font-medium text-white"
          : muted
            ? "border-line bg-paper text-slate"
            : "border-line bg-paper text-ink",
      )}
    >
      {children}
    </div>
  );
}

function Connector({ accent = false }: { accent?: boolean }) {
  return (
    <div aria-hidden="true" class="flex h-8 items-center justify-center">
      <span class={clsx("h-full w-px", accent ? "bg-accent" : "bg-line")} />
    </div>
  );
}

export function WhyClearing() {
  return (
    <Section id="why-clearing">
      <Reveal>
        <Label>Why clearing matters</Label>
      </Reveal>

      <div class="md:flex md:items-end md:justify-between md:gap-20">
        <Reveal delay={60}>
          <SectionHeading>
            A gateway moves money. A clearing layer knows what it means.
          </SectionHeading>
        </Reveal>
        <Reveal delay={120}>
          <Lede class="md:mb-3 md:max-w-[36ch]">
            The difference is where the truth of a payment lives — inside someone else's dashboard,
            or inside your own system of record, whichever of the three paths moved the value.
          </Lede>
        </Reveal>
      </div>

      <div class="mt-12 grid gap-px border-y border-line bg-line md:mt-16 lg:grid-cols-2">
        <div class="bg-paper px-6 py-12 md:px-14 md:py-16">
          <Reveal>
            <p class="label text-slate">Traditional gateway</p>
            <div class="mx-auto mt-12 max-w-xs">
              {TRADITIONAL.map((node, index) => (
                <div key={node}>
                  {index > 0 ? <Connector /> : null}
                  <Node muted={index > 0}>{node}</Node>
                </div>
              ))}
              <p class="mt-10 text-center text-sm leading-[1.7] text-slate">
                One hop, one provider, one opinion about what happened. Routing, ledger and
                reconciliation become your glue code.
              </p>
            </div>
          </Reveal>
        </div>

        <div class="bg-paper px-6 py-12 md:px-14 md:py-16">
          <Reveal delay={120}>
            <p class="label text-forest">With Mayarin</p>
            <div class="mx-auto mt-12 max-w-xs">
              {MAYARIN.map((node, index) => (
                <div key={node}>
                  {index > 0 ? <Connector accent /> : null}
                  <Node emphasis={index === 2}>{node}</Node>
                </div>
              ))}
              <p class="mt-10 text-center text-sm leading-[1.7] text-slate">
                Each hop is explicit, persisted and replayable. The engine owns the sequence, so
                providers change without your product noticing.
              </p>
            </div>
          </Reveal>
        </div>
      </div>

      <div class="mt-12 grid gap-12 md:mt-16 md:grid-cols-2 md:gap-16 xl:grid-cols-4">
        {DIFFERENCES.map((difference, index) => (
          <Reveal key={difference.title} delay={index * 90}>
            <h3 class="text-[23.5px] font-medium tracking-[-0.01em]">{difference.title}</h3>
            <p class="mt-4 max-w-[40ch] text-sm leading-[1.75] text-slate">{difference.body}</p>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

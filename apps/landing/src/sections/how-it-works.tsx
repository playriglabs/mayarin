import clsx from "clsx";
import { useEffect, useRef, useState } from "preact/hooks";
import { Reveal } from "../components/reveal.tsx";
import { Label, Lede, Section, SectionHeading } from "../components/ui.tsx";
import { stageScenes } from "../graphics/stage-scene.tsx";

type Stage = {
  index: string;
  title: string;
  body: string;
  /** Clearing-engine states this stage passes through. */
  states: string[];
  /** What exists once the stage has run. */
  artifact: string;
};

const STAGES: Stage[] = [
  {
    index: "01",
    title: "Application",
    body: "Your product — or an agent hitting a gated endpoint — states what should happen: who pays, who gets paid, in which asset. Nothing about rails, providers or chains leaks into your code.",
    states: ["CREATED"],
    artifact: "POST /payment-intents · Idempotency-Key",
  },
  {
    index: "02",
    title: "Payment Intent",
    body: "An immutable aggregate. Every transition returns a new value with a higher version, and that version is the lock — concurrent writes are rejected, never merged.",
    states: ["CREATED", "QR_PARSED"],
    artifact: "merchant, amount and asset validated against the registry",
  },
  {
    index: "03",
    title: "Liquidity Routing",
    body: "The payer's asset is priced against an oracle and routed into the stablecoin the merchant is paid in. The rate is locked, with a settlement minimum and a deadline, before anyone is asked to pay.",
    states: ["PRICE_LOCKED", "PAYMENT_PENDING", "ASSET_RECEIVED"],
    artifact: "quote locked · execution path chosen for this payment",
  },
  {
    index: "04",
    title: "Clearing",
    body: "Balanced double-entry postings land in the same database transaction as the state change. Nothing writes a balance directly, so the books cannot drift from the payment.",
    states: ["CLEARING"],
    artifact: "debit and credit, or LedgerImbalanceError",
  },
  {
    index: "05",
    title: "Settlement",
    body: "Value moves on-chain, or through a provider adapter, and is confirmed by reading the result back — never against a webhook or a facilitator's word alone. A spoofed callback settles nothing.",
    states: ["SETTLING", "SETTLED"],
    artifact: "chain evidence · each step keyed by transaction and state",
  },
  {
    index: "06",
    title: "Merchant payout",
    body: "The merchant is paid in the settlement stablecoin to their wallet. The event log left behind is the audit trail, not a reconstruction of one.",
    states: ["SUCCESS"],
    artifact: "terminal state · every transition replayable",
  },
];

/**
 * The three ways value actually moves. Chosen per payment, not per deployment:
 * they serve different payers rather than acting as fallbacks for one another.
 */
const PATHS = [
  {
    name: "On-chain contract",
    body: "The payer calls PaymentRouter with a signed order. Receive, optional swap and merchant settlement happen in one atomic transaction.",
    wire: "PaymentCompleted · indexed into clearing",
  },
  {
    name: "Deposit match",
    body: "The payer transfers to a unique per-intent address — a QR scan, or a withdrawal from an exchange. The watcher confirms it and a treasury executor settles.",
    wire: "per-intent address · confirmation depth · reorg-aware",
  },
  {
    name: "x402",
    body: "The payer signs one authorization and a facilitator broadcasts it. No deposit address is derived: the payment is identified by the authorization nonce.",
    wire: "EIP-3009 · verify · settle · read back",
  },
];

const DWELL_MS = 6500;

function StateChips({ states, tone = "dark" }: { states: string[]; tone?: "dark" | "light" }) {
  const chip = tone === "light" ? "border-line text-forest" : "border-line-inverse text-accent";
  const separator = tone === "light" ? "text-slate" : "text-slate-inverse";

  return (
    <div class="flex flex-wrap items-center gap-2">
      {states.map((state, index) => (
        <span key={state} class="flex items-center gap-2">
          {index > 0 ? (
            <span aria-hidden="true" class={separator}>
              ›
            </span>
          ) : null}
          <span class={clsx("label border px-2.5 py-1.5", chip)}>{state}</span>
        </span>
      ))}
    </div>
  );
}

export function HowItWorks() {
  const [active, setActive] = useState(0);
  const [running, setRunning] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const walkthroughRef = useRef<HTMLDivElement | null>(null);

  // The walkthrough only advances while it is on screen and nobody is driving
  // it by hand — an autoplay nobody can see is wasted work.
  useEffect(() => {
    const node = walkthroughRef.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setRunning(entry.isIntersecting);
      },
      { threshold: 0.35 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(
      () => setActive((current) => (current + 1) % STAGES.length),
      DWELL_MS,
    );
    return () => window.clearInterval(timer);
  }, [running]);

  const select = (index: number) => {
    setActive(index);
    setRunning(false);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, number> = {
      ArrowDown: 1,
      ArrowRight: 1,
      ArrowUp: -1,
      ArrowLeft: -1,
    };

    const delta = moves[event.key];
    let next = active;

    if (delta !== undefined) next = (active + delta + STAGES.length) % STAGES.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = STAGES.length - 1;
    else return;

    event.preventDefault();
    select(next);
    listRef.current?.querySelectorAll("button")[next]?.focus();
  };

  const stage = STAGES[active];
  if (!stage) return null;

  return (
    <Section id="how-it-works" tone="dark">
      <Reveal>
        <Label tone="dark">How Mayarin works</Label>
      </Reveal>

      <div class="md:flex md:items-end md:justify-between md:gap-20">
        <Reveal delay={60}>
          <SectionHeading>One path, from intent to a merchant getting paid.</SectionHeading>
        </Reveal>
        <Reveal delay={120}>
          <Lede tone="dark" class="md:mb-3 md:max-w-[38ch]">
            Every stage is persisted, replayable and observable. A crash between two stages resumes
            at the stage, not at the beginning.
          </Lede>
        </Reveal>
      </div>

      {/* Tablet and up: the stage list drives a detail panel. */}
      <div
        ref={walkthroughRef}
        class="mt-14 hidden border-t border-line-inverse md:mt-20 md:grid md:grid-cols-[1fr_1.1fr] md:gap-px md:bg-line-inverse"
      >
        <div
          ref={listRef}
          role="tablist"
          aria-label="Clearing stages"
          aria-orientation="vertical"
          onMouseEnter={() => setRunning(false)}
          class="bg-void md:pr-10 lg:pr-16"
        >
          {STAGES.map((item, index) => {
            const selected = index === active;
            return (
              <button
                key={item.index}
                type="button"
                role="tab"
                id={`stage-tab-${item.index}`}
                aria-selected={selected}
                aria-controls="stage-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => select(index)}
                onKeyDown={onKeyDown}
                class="group relative block w-full cursor-pointer border-b border-line-inverse py-6 text-left"
              >
                <span class="flex items-baseline gap-6">
                  <span
                    class={clsx(
                      "label transition-colors duration-300",
                      selected ? "text-accent" : "text-slate-inverse",
                    )}
                  >
                    {item.index}
                  </span>
                  <span
                    class={clsx(
                      "font-sans text-lg tracking-[-0.01em] transition-colors duration-300 lg:text-xl",
                      selected ? "text-white" : "text-slate-inverse group-hover:text-white",
                    )}
                  >
                    {item.title}
                  </span>
                </span>

                {/* The dwell timer, drawn: it fills for as long as the stage is held. */}
                <span aria-hidden="true" class="absolute inset-x-0 -bottom-px h-px overflow-hidden">
                  {selected ? (
                    <span
                      key={`${item.index}:${running}`}
                      class={clsx("block h-full origin-left bg-accent", running && "stage-fill")}
                      style={running ? `animation-duration:${DWELL_MS}ms` : undefined}
                    />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>

        {/* The stage as a poster: green plate on top, editorial copy below. */}
        <div
          id="stage-panel"
          role="tabpanel"
          aria-labelledby={`stage-tab-${stage.index}`}
          class="bg-void md:pl-10 lg:pl-16"
        >
          <article class="flex h-full flex-col border border-line-inverse">
            <div class="relative aspect-16/10 overflow-hidden border-b border-line-inverse bg-plate/30">
              {/* The scene stages its own parts in; a wrapper slide on top of that reads as two moves. */}
              <div key={`${stage.index}:scene`} class="h-full w-full">
                {stageScenes[stage.index]?.()}
              </div>
              <span class="label absolute top-5 left-5 text-white/55">
                {stage.index} / {STAGES.length.toString().padStart(2, "0")}
              </span>
            </div>

            <div key={stage.index} class="stage-enter flex flex-1 flex-col p-7 lg:p-9">
              <h3 class="max-w-[18ch] text-[clamp(1.75rem,2.6vw,2.5rem)] leading-[1.04] tracking-normal text-white">
                {stage.title}
              </h3>
              <p class="mt-4 max-w-[46ch] text-[0.9375rem] leading-[1.7] text-slate-inverse">
                {stage.body}
              </p>

              <div class="mt-auto pt-8">
                <StateChips states={stage.states} />
                <p class="mt-4 font-mono text-[0.75rem] leading-[1.7] text-slate-inverse">
                  {stage.artifact}
                </p>
              </div>
            </div>

            {/* Where the payment has got to, as a bar of six. */}
            <div aria-hidden="true" class="flex gap-1 px-7 pb-7 lg:px-9 lg:pb-9">
              {STAGES.map((item, index) => (
                <span
                  key={item.index}
                  class={clsx(
                    "h-0.75 flex-1 transition-colors duration-500",
                    index === active
                      ? "bg-accent"
                      : index < active
                        ? "bg-accent/10"
                        : "bg-line-inverse/10",
                  )}
                />
              ))}
            </div>
          </article>
        </div>
      </div>

      {/* Phones: the same six stages as a stack of posters, nothing to drive. */}
      <ol class="mt-12 grid gap-5 md:hidden">
        {STAGES.map((item, index) => (
          <Reveal key={item.index} as="li" delay={index * 40}>
            <article class="border border-line-inverse">
              <div class="relative aspect-16/10 overflow-hidden border-b border-line-inverse bg-plate">
                {stageScenes[item.index]?.()}
                <span class="label absolute top-4 left-4 text-white/55">
                  {item.index} / {STAGES.length.toString().padStart(2, "0")}
                </span>
              </div>
              <div class="p-6">
                <h3 class="text-[2rem] leading-[1.05] text-white tracking-normal">{item.title}</h3>
                <p class="mt-3 text-sm leading-[1.7] text-slate-inverse">{item.body}</p>
                <div class="mt-6">
                  <StateChips states={item.states} />
                </div>
              </div>
            </article>
          </Reveal>
        ))}
      </ol>

      {/* One engine, three ways value moves. Named here because the walkthrough
          above is deliberately path-agnostic: every payment runs those six
          stages, and only this choice differs. */}
      <div class="mt-14 border-t border-line-inverse pt-12 md:mt-20">
        <Reveal>
          <h3 class="max-w-[24ch] text-[clamp(2rem,2.8vw,3rem)] leading-[1.1] tracking-normal text-white">
            Three execution paths, one clearing engine.
          </h3>
          <p class="mt-4 max-w-[54ch] text-[0.9375rem] leading-[1.7] text-slate-inverse">
            Which one applies is chosen per payment, not per deployment. They serve different
            payers; none of them is the other's fallback.
          </p>
        </Reveal>

        <div class="mt-10 grid gap-px bg-line-inverse md:grid-cols-3">
          {PATHS.map((path, index) => (
            <Reveal key={path.name} delay={index * 80}>
              <div
                class={clsx(
                  "flex h-full flex-col bg-void py-8 md:px-8 md:py-2",
                  index === 0 && "md:pl-0",
                )}
              >
                <h4 class="font-sans text-xl font-medium tracking-[-0.01em] text-white">
                  {path.name}
                </h4>
                <p class="mt-3 max-w-[40ch] flex-1 text-sm leading-[1.75] text-slate-inverse">
                  {path.body}
                </p>
                <code class="mt-6 block text-[0.7rem] tracking-[0.02em] text-slate-inverse">
                  {path.wire}
                </code>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}

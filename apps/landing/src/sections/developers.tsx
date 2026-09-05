import { snippets } from "virtual:code-snippets";
import clsx from "clsx";
import { useState } from "preact/hooks";
import { CodeBlock } from "../components/code-block.tsx";
import { Reveal } from "../components/reveal.tsx";
import { ArrowRight, Button, Label, Lede, Section } from "../components/ui.tsx";
import { HoverGrid } from "../graphics/hover-grid.tsx";

const PROMISES = [
  {
    title: "Idempotent by construction",
    body: "Every mutation takes a key. Replay the same request a hundred times and value moves once.",
  },
  {
    title: "Typed end to end",
    body: "Requests, responses and events share one schema, published as OpenAPI 3.1. Money carries its asset with it, always.",
  },
  {
    title: "Observable by default",
    body: "Every transition is an event you can read back — the audit trail is the source of truth, not a log file.",
  },
];

export function Developers() {
  const [active, setActive] = useState(0);
  const snippet = snippets[active] ?? snippets[0];
  if (!snippet) return null;

  return (
    <Section id="developers" tone="dark" backdrop={<HoverGrid tone="dark" />}>
      <Reveal>
        <Label tone="dark">Developer experience</Label>
      </Reveal>

      {/* Heading and the way in sit together, so the code below gets full width. */}
      <div class="mt-7 grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:items-end lg:gap-20">
        <Reveal delay={60}>
          <h2 class="max-w-[16ch] text-[clamp(3rem,5.2vw,4.25rem)]">
            An integration you can hold in your head.
          </h2>
        </Reveal>

        <Reveal delay={120} class="lg:pb-3">
          <Lede tone="dark" class="mt-0 max-w-[42ch]">
            One resource to create, one signal to handle, one state machine behind both — and one
            middleware when the payer is a program.
          </Lede>
          <div class="mt-8 flex flex-wrap gap-3">
            <Button href="https://docs.mayarin.xyz" variant="primary-dark">
              Start building
              <ArrowRight />
            </Button>
            <Button href="https://docs.mayarin.xyz" variant="secondary-dark">
              API reference
            </Button>
          </div>
        </Reveal>
      </div>

      <Reveal delay={80} class="mt-14 md:mt-20">
        <div
          role="tablist"
          aria-label="Code examples"
          class="flex items-center gap-x-8 overflow-x-auto border-b border-line-inverse scrollbar-none [&::-webkit-scrollbar]:hidden"
        >
          {snippets.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`snippet-tab-${item.id}`}
              aria-selected={index === active}
              aria-controls={`snippet-panel-${item.id}`}
              tabIndex={index === active ? 0 : -1}
              onClick={() => setActive(index)}
              class={clsx(
                "-mb-px shrink-0 cursor-pointer whitespace-nowrap border-b py-3.5 text-sm transition-colors duration-200",
                index === active
                  ? "border-accent text-white"
                  : "border-transparent text-slate-inverse hover:text-white",
              )}
            >
              {item.tab}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id={`snippet-panel-${snippet.id}`}
          aria-labelledby={`snippet-tab-${snippet.id}`}
          class="mt-6"
        >
          <CodeBlock snippet={snippet} />
        </div>
      </Reveal>

      {/* The three promises read as a footer to the code, not a sidebar. */}
      <div class="mt-14 grid gap-px border-t border-line-inverse bg-line-inverse md:mt-16 md:grid-cols-3">
        {PROMISES.map((promise, index) => (
          <div key={promise.title} class="bg-void md:px-8 md:first:pl-0 md:last:pr-0">
            <Reveal delay={index * 80} class="py-8">
              <h3 class="font-display text-2xl font-medium tracking-[-0.01em] text-white">
                {promise.title}
              </h3>
              <p class="mt-3 max-w-[40ch] text-sm leading-[1.75] text-slate-inverse">
                {promise.body}
              </p>
            </Reveal>
          </div>
        ))}
      </div>
    </Section>
  );
}

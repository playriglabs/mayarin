import { assetLogoUrl } from "@mayarin/shared";
import clsx from "clsx";
import { useRef, useState } from "preact/hooks";
import { Reveal } from "../reveal.tsx";
import { INDUSTRIES, type Solution, type SolutionKind } from "../use-case-content.tsx";

/**
 * Industries as tabs, each showing its two solutions side by side. A WAI-ARIA
 * tablist: one tab stop, arrow keys move between industries, Home and End jump
 * to the ends.
 */
export function UseCases() {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const industry = INDUSTRIES[active] ?? INDUSTRIES[0];
  if (industry === undefined) return null;

  const select = (index: number) => {
    const next = (index + INDUSTRIES.length) % INDUSTRIES.length;
    setActive(next);
    tabs.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const target =
      event.key === "ArrowRight"
        ? active + 1
        : event.key === "ArrowLeft"
          ? active - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? INDUSTRIES.length - 1
              : undefined;
    if (target === undefined) return;
    event.preventDefault();
    select(target);
  };

  return (
    <section id="use-cases" class="mx-auto w-full max-w-300 px-5 py-20 md:px-10 md:py-28">
      <Reveal class="mx-auto max-w-180 text-center">
        <p class="inline-flex rounded-full border border-line px-3 py-1 text-xs text-slate-600">
          Solutions for every industry
        </p>
        <h2 class="mt-6 text-balance">
          <span class="text-forest">One integration.</span> Every way your money moves.
        </h2>
      </Reveal>

      <Reveal delay={120}>
        <div
          role="tablist"
          aria-label="Industries"
          class="mx-auto mt-10 flex max-w-260 flex-wrap justify-center gap-2 md:mt-12 md:gap-3"
          onKeyDown={onKeyDown}
        >
          {INDUSTRIES.map((item, index) => {
            const selected = index === active;
            return (
              <button
                key={item.id}
                ref={(element) => {
                  tabs.current[index] = element;
                }}
                type="button"
                role="tab"
                id={`use-case-tab-${item.id}`}
                aria-selected={selected}
                aria-controls="use-case-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(index)}
                class={clsx(
                  "min-h-11 cursor-pointer rounded-full border px-4 py-2 text-sm transition-colors duration-200 md:px-5 md:text-base",
                  selected
                    ? "border-forest bg-forest text-paper"
                    : "border-line text-slate-600 hover:border-forest hover:text-forest",
                )}
              >
                {item.name}
              </button>
            );
          })}
        </div>
      </Reveal>

      <div
        id="use-case-panel"
        role="tabpanel"
        aria-labelledby={`use-case-tab-${industry.id}`}
        class="mx-auto mt-10 grid max-w-240 gap-4 md:mt-12 md:grid-cols-2 md:gap-5"
      >
        {industry.solutions.map((solution) => (
          <SolutionCard key={`${industry.id}-${solution.label}`} solution={solution} />
        ))}
      </div>
    </section>
  );
}

function SolutionCard({ solution }: { readonly solution: Solution }) {
  return (
    <article class="flex flex-col rounded-2xl border border-line bg-paper p-6 text-center md:p-8">
      <p class="text-sm text-slate-600">{solution.label}</p>
      <h3 class="mx-auto mt-2 max-w-[18ch] text-[1.5rem] md:text-[1.75rem]">{solution.title}</h3>
      <div
        aria-hidden="true"
        class="my-8 flex min-h-44 items-center justify-center motion-safe:animate-[fade-in_300ms_ease-out]"
      >
        <SolutionVisual kind={solution.kind} />
      </div>
      <p class="mx-auto mt-auto max-w-[38ch] text-[15px] leading-relaxed text-slate-600">
        {solution.body}
      </p>
    </article>
  );
}

function SolutionVisual({ kind }: { readonly kind: SolutionKind }) {
  switch (kind) {
    case "checkout":
      return <CheckoutVisual />;
    case "payouts":
      return <PayoutsVisual />;
    case "invoice":
      return <InvoiceVisual />;
    case "recurring":
      return <RecurringVisual />;
    case "api":
      return <ApiVisual />;
    case "counter":
      return <CounterVisual />;
  }
}

/** Payer-side asset choices, the chosen one raised like a selected option. */
function CheckoutVisual() {
  const options = [
    { asset: "ETH", selected: false },
    { asset: "EURC", selected: false },
    { asset: "USDG", selected: true },
  ];
  return (
    <div class="relative w-full max-w-64 text-left text-sm">
      {options.map((option, index) => (
        <div
          key={option.asset}
          style={{ marginLeft: `${(options.length - 1 - index) * 14}px` }}
          class={clsx(
            "-mt-2 flex items-center gap-3 rounded-lg border px-4 py-3 shadow-sm first:mt-0",
            option.selected
              ? "relative border-forest bg-forest text-paper"
              : "border-line bg-paper text-ink",
          )}
        >
          <span
            class={clsx(
              "size-3 rounded-full border",
              option.selected ? "border-paper bg-paper/30" : "border-line",
            )}
          />
          Pay with {option.asset}
          <TokenLogo asset={option.asset} class="ml-auto size-5" />
        </div>
      ))}
    </div>
  );
}

function TokenLogo({
  asset,
  class: className,
}: {
  readonly asset: string;
  readonly class: string;
}) {
  return (
    <img
      src={assetLogoUrl(asset)}
      alt=""
      width={20}
      height={20}
      loading="lazy"
      decoding="async"
      class={clsx("shrink-0 rounded-full", className)}
    />
  );
}

/** One sender fanning out to several recipients, in one transaction. */
function PayoutsVisual() {
  const recipients = ["0x8f…a1", "0x3c…7e", "0xd2…40"];
  return (
    <div class="flex w-full max-w-72 flex-col items-center text-xs">
      <span class="inline-flex items-center gap-1.5 rounded-full border border-forest bg-v2-sage px-3 py-1.5 font-medium text-forest">
        <TokenLogo asset="USDG" class="size-4" />1 transaction · USDG
      </span>
      <svg viewBox="0 0 240 40" class="h-10 w-full text-forest/50" fill="none" aria-hidden="true">
        <path d="M120 0v12M120 12L40 40M120 12v28M120 12l80 28" stroke="currentColor" />
      </svg>
      <div class="grid w-full grid-cols-3 gap-2">
        {recipients.map((address) => (
          <span key={address} class="rounded-md border border-line bg-v2-mist px-2 py-2 font-mono">
            {address}
          </span>
        ))}
      </div>
    </div>
  );
}

function InvoiceVisual() {
  return (
    <div class="w-full max-w-56 rounded-lg border border-line bg-paper p-4 text-left text-xs shadow-sm">
      <div class="flex items-center justify-between">
        <span class="font-medium text-ink">Invoice INV-0042</span>
        <span class="rounded-full bg-v2-sage px-2 py-0.5 text-forest">Paid</span>
      </div>
      <div class="mt-4 space-y-2 text-slate-600">
        <div class="flex justify-between">
          <span>Design retainer</span>
          <span>€2.400,00</span>
        </div>
        <div class="flex justify-between">
          <span>Hosting</span>
          <span>€120,00</span>
        </div>
      </div>
      <div class="mt-4 flex justify-between border-t border-line pt-3 font-medium text-ink">
        <span>Total</span>
        <span>€2.520,00</span>
      </div>
    </div>
  );
}

function RecurringVisual() {
  const cycles = [
    { month: "Aug", status: "Paid" },
    { month: "Sep", status: "Paid" },
    { month: "Oct", status: "Due" },
  ];
  return (
    <ul class="w-full max-w-56 space-y-2 text-left text-sm">
      {cycles.map((cycle) => (
        <li
          key={cycle.month}
          class="flex items-center justify-between rounded-lg border border-line bg-paper px-4 py-2.5"
        >
          <span class="text-ink">{cycle.month} cycle</span>
          <span
            class={clsx(
              "rounded-full px-2 py-0.5 text-xs",
              cycle.status === "Paid" ? "bg-v2-sage text-forest" : "bg-v2-mist text-slate-600",
            )}
          >
            {cycle.status}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ApiVisual() {
  return (
    <pre class="w-full max-w-64 overflow-hidden rounded-lg bg-code-panel p-4 text-left font-mono text-[11px] leading-relaxed text-white/70">
      <span class="text-accent">HTTP/1.1 402</span> Payment Required{"\n"}
      amount: <span class="text-white">0.01 USDG</span>
      {"\n"}
      {"\n"}
      <span class="text-accent">HTTP/1.1 200</span> OK
    </pre>
  );
}

function CounterVisual() {
  return (
    <div class="rounded-xl border border-line bg-paper p-3 shadow-sm">
      <img
        src="/images/product/mayarin-qr.png"
        alt=""
        width={160}
        height={160}
        loading="lazy"
        decoding="async"
        class="size-40"
      />
    </div>
  );
}

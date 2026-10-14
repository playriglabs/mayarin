import { assetSymbol } from "@mayarin/shared";
import clsx from "clsx";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { gsap, registerGsap } from "../../lib/gsap.ts";
import { Reveal } from "../reveal.tsx";
import { CURRENCY_MARKETS } from "./currency-markets.ts";

/**
 * What a merchant gets from Mayarin, as a bento: two rows, a wide card beside a
 * narrow one, flipped on the second row. Every illustration is decorative —
 * the figures in them are sample values, never claims; the claim is the
 * sentence under each one.
 */
export function Benefits() {
  return (
    <section id="benefits" class="mx-auto w-full max-w-300 px-5 py-20 md:px-10 md:py-28">
      <div class="grid items-end gap-6 lg:grid-cols-[1.6fr_1fr] lg:gap-16">
        <Reveal>
          <h2 class="text-balance">
            <span class="text-forest">Let customers pay their way,</span> settle in the stablecoin
            you choose.
          </h2>
        </Reveal>
        <Reveal delay={120}>
          <p class="max-w-105 text-base leading-relaxed text-slate-600 md:text-lg">
            Mayarin turns whatever the payer brings into your stablecoin, so you reach more
            customers, get paid faster and never touch the blockchain.
          </p>
        </Reveal>
      </div>

      <div class="mt-12 grid gap-5 md:mt-16 lg:grid-cols-[1.5fr_1fr]">
        <BenefitCard
          title="Reach more payers"
          body="Accept local methods like bank transfer and e-wallets, or any supported asset on any supported chain. Customers pay the way they already do, and the order still lands in your currency."
          raised
        >
          <GrowthVisual />
        </BenefitCard>
        <BenefitCard
          title="Get paid in minutes"
          body="Your stablecoin lands on-chain once the payment confirms, not days later when a card batch clears."
          delay={90}
        >
          <SettlementVisual />
        </BenefitCard>
      </div>
      <div class="mt-5 grid gap-5 lg:grid-cols-[1fr_1.5fr]">
        <BenefitCard
          title="Price locally, sell globally"
          body={`Quote in ${CURRENCY_MARKETS.length} local currencies from one integration. The rate is locked at checkout, so the price your customer sees is the price you get.`}
        >
          <MarketsVisual />
        </BenefitCard>
        <BenefitCard
          title="No chargebacks"
          body="A confirmed on-chain payment cannot be pulled back by the payer. No chargeback fraud, no dispute fees."
          delay={90}
        >
          <ChargebackVisual />
        </BenefitCard>
      </div>
    </section>
  );
}

function BenefitCard({
  title,
  body,
  raised = false,
  delay = 0,
  children,
}: {
  readonly title: string;
  readonly body: string;
  readonly raised?: boolean;
  readonly delay?: number;
  readonly children: ComponentChildren;
}) {
  return (
    <Reveal
      delay={delay}
      class={clsx(
        "relative isolate flex min-h-120 flex-col overflow-hidden rounded-2xl border border-line bg-paper p-6 md:p-9",
        raised && "shadow-[0_24px_60px_-30px_rgb(17_17_17/0.25)]",
      )}
    >
      <h3 class="relative z-10 text-[1.75rem] md:text-[2.25rem]">{title}</h3>
      <div aria-hidden="true" class="relative flex flex-1 items-center justify-center py-8">
        {children}
      </div>
      <p class="relative z-10 max-w-[58ch] text-base leading-relaxed text-slate-600 md:text-[17px]">
        {body}
      </p>
    </Reveal>
  );
}

function Chip({
  children,
  class: className,
}: {
  readonly children: ComponentChildren;
  readonly class?: string;
}) {
  return (
    <span
      class={clsx(
        "whitespace-nowrap rounded-md border border-line bg-paper px-3 py-1.5 text-xs text-ink shadow-sm md:text-sm",
        className,
      )}
    >
      {children}
    </span>
  );
}

function TrendUp() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      class="size-4 text-forest"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
    >
      <rect x="1" y="1" width="14" height="14" rx="3" stroke-opacity="0.4" />
      <path d="M4 10.5l2.5-2.5 2 2L12 6.5M9.5 6.5H12V9" />
    </svg>
  );
}

/**
 * Loops a timeline from the moment the illustration first scrolls into view. The
 * prerendered markup is the finished state, so no JavaScript and reduced
 * motion both see the illustration complete; the timeline only animates
 * *from* elsewhere back to it.
 */
function useEntryTimeline<T extends HTMLElement>(build: (timeline: gsap.core.Timeline) => void) {
  const root = useRef<T>(null);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    registerGsap();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const context = gsap.context(() => {
      build(
        gsap.timeline({
          defaults: { ease: "power2.out" },
          repeat: -1,
          repeatDelay: 2.5,
          scrollTrigger: { trigger: node, start: "top 80%", once: true },
        }),
      );
    }, node);
    return () => context.revert();
  }, []);
  return root;
}

const REVENUE = 48_210;
const formatRevenue = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A growth curve with the moment Mayarin was added marked on it: the line
 * draws itself, the area fills behind it, the revenue counts up and each
 * marker lands as the line reaches it.
 */
function GrowthVisual() {
  const root = useEntryTimeline<HTMLDivElement>((timeline) => {
    const revenue = root.current?.querySelector("[data-revenue]");
    const counter = { value: 0 };
    timeline
      .fromTo(
        "[data-line]",
        { strokeDashoffset: 1 },
        { strokeDashoffset: 0, duration: 1.8, ease: "power2.inOut" },
        0,
      )
      .fromTo(
        "[data-area]",
        { clipPath: "inset(0 100% 0 0)" },
        { clipPath: "inset(0 0% 0 0)", duration: 1.8, ease: "power2.inOut" },
        0,
      )
      .to(
        counter,
        {
          value: REVENUE,
          duration: 1.8,
          ease: "power3.out",
          onUpdate: () => {
            if (revenue) revenue.textContent = formatRevenue(counter.value);
          },
        },
        0,
      )
      .from(
        "[data-marker]",
        { autoAlpha: 0, y: 10, duration: 0.5, ease: "back.out(2)", stagger: 0.7 },
        0.7,
      );
  });

  return (
    <div ref={root} class="absolute -inset-x-9 -top-24 -bottom-8">
      <svg
        aria-hidden="true"
        viewBox="0 0 600 360"
        preserveAspectRatio="none"
        class="absolute inset-0 size-full"
      >
        <defs>
          <linearGradient id="benefit-growth" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--color-forest)" stop-opacity="0.22" />
            <stop offset="1" stop-color="var(--color-forest)" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path
          data-area
          d="M0 330 C 200 300, 380 250, 600 0 L600 360 L0 360 Z"
          fill="url(#benefit-growth)"
        />
        {/* `pathLength` makes the dash one whole line long, so the draw is a
            single offset from 1 to 0. No `non-scaling-stroke`: it would put
            the dash in screen pixels and break that. */}
        <path
          data-line
          d="M0 330 C 200 300, 380 250, 600 0"
          pathLength={1}
          stroke-dasharray="1"
          fill="none"
          stroke="var(--color-forest)"
          stroke-width="1.5"
        />
      </svg>
      <div class="absolute left-9 top-36 rounded-lg border border-line bg-paper px-4 py-3 shadow-sm">
        <p class="text-xs text-slate-600 md:text-sm">Revenue</p>
        <p class="mt-1 flex items-center gap-2 text-lg font-medium tabular-nums text-ink md:text-xl">
          <span data-revenue>{formatRevenue(REVENUE)}</span> <TrendUp />
        </p>
      </div>
      <div data-marker class="absolute left-[36%] top-[58%] flex flex-col items-center">
        <Chip>Mayarin added</Chip>
        <span class="h-14 border-l border-dashed border-forest/40" />
        <span class="size-2.5 rounded-full border border-forest bg-paper" />
      </div>
      <div data-marker class="absolute left-[72%] top-[22%] flex flex-col items-center">
        <Chip>New payers</Chip>
        <span class="h-16 border-l border-dashed border-forest/40" />
        <span class="relative flex size-3">
          <span class="absolute inset-0 rounded-full bg-forest/40 motion-safe:animate-ping" />
          <span class="relative size-3 rounded-full bg-forest" />
        </span>
      </div>
    </div>
  );
}

/**
 * Two settlement timelines stacked: the card batch lands first and stays
 * pending, the on-chain one lands after it and settles, then the verdict.
 */
function SettlementVisual() {
  const root = useEntryTimeline<HTMLDivElement>((timeline) => {
    timeline
      .from("[data-card-batch]", { autoAlpha: 0, y: 24, rotate: 8, duration: 0.6 })
      .from("[data-on-chain]", { autoAlpha: 0, y: 24, rotate: -6, duration: 0.6 }, "-=0.2")
      .from("[data-settled]", { autoAlpha: 0, scale: 0.6, duration: 0.4, ease: "back.out(3)" })
      .from("[data-minutes]", {
        autoAlpha: 0,
        x: -30,
        rotate: -10,
        duration: 0.6,
        ease: "back.out(1.6)",
      });
  });

  return (
    <div ref={root} class="relative h-44 w-full max-w-80 text-left">
      <div
        data-minutes
        class="absolute left-0 top-2 z-10 -rotate-2 rounded-lg bg-forest px-4 py-3 text-paper shadow-md"
      >
        <p class="text-xs text-paper/80">Settled in</p>
        <p class="mt-1 text-xl font-medium">minutes</p>
      </div>
      <div
        data-card-batch
        class="absolute right-0 top-0 w-52 rotate-2 rounded-lg border border-line bg-paper px-4 py-3 shadow-sm"
      >
        <div class="flex justify-between text-xs text-slate-600">
          <span class="text-ink">Card batch</span>
          <span>T+2</span>
        </div>
        <p class="mt-2 text-lg font-medium text-slate-600">Pending</p>
      </div>
      <div
        data-on-chain
        class="absolute bottom-0 left-12 w-56 -rotate-1 rounded-lg border border-line bg-paper px-4 py-3 shadow-sm"
      >
        <div class="flex justify-between text-xs text-slate-600">
          <span class="text-ink">On-chain · USDC</span>
          <span>Confirmed</span>
        </div>
        <p class="mt-2 flex items-center justify-between text-lg font-medium text-ink">
          $1,250.00
          <span
            data-settled
            class="rounded-full bg-v2-sage px-2 py-0.5 text-xs font-normal text-forest"
          >
            Settled
          </span>
        </p>
      </div>
    </div>
  );
}

/**
 * Local prices on a dotted ground, all wired back to one integration: the
 * integration lands, then each currency arrives along its line.
 */
function MarketsVisual() {
  const markets = [
    { code: "SGD", class: "left-[4%] top-[12%]" },
    { code: "BRL", class: "left-[8%] bottom-[14%]" },
    { code: "EUR", class: "right-[6%] top-[8%]" },
    { code: "JPY", class: "right-[2%] bottom-[22%]" },
    { code: "SAR", class: "left-1/2 top-0 -translate-x-1/2" },
    { code: "CNY", class: "left-1/2 bottom-0 -translate-x-1/2" },
  ] as const;

  const root = useEntryTimeline<HTMLDivElement>((timeline) => {
    timeline
      .from("[data-dots]", { autoAlpha: 0, scale: 1.1, duration: 0.8 })
      .from(
        "[data-hub]",
        { autoAlpha: 0, scale: 0.6, duration: 0.5, ease: "back.out(2.5)" },
        "-=0.4",
      )
      .from("[data-wires]", { autoAlpha: 0, duration: 0.5 })
      .from(
        "[data-market]",
        { autoAlpha: 0, y: 12, duration: 0.45, ease: "back.out(2)", stagger: 0.15 },
        "-=0.2",
      );
  });

  return (
    <div ref={root} class="relative h-64 w-full">
      <div
        data-dots
        class="absolute inset-0 bg-[radial-gradient(var(--color-forest)_1px,transparent_1.2px)] bg-size-[10px_10px] opacity-20 mask-[radial-gradient(ellipse_at_center,black_35%,transparent_75%)]"
      />
      <svg
        data-wires
        aria-hidden="true"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        class="absolute inset-0 size-full"
        fill="none"
      >
        <path
          d="M18 20 L50 50 M22 82 L50 50 M84 16 L50 50 M86 74 L50 50 M50 12 L50 50 M50 88 L50 50"
          stroke="var(--color-forest)"
          stroke-opacity="0.35"
          stroke-dasharray="2 2"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <span
        data-hub
        class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-forest px-3 py-1.5 text-xs font-medium text-paper shadow-md"
      >
        One integration
      </span>
      {markets.map((market) => (
        <span key={market.code} data-market class={clsx("absolute", market.class)}>
          <Chip>
            <span class="mr-1.5 text-slate-600">{assetSymbol(market.code)}</span>
            {market.code}
          </Chip>
        </span>
      ))}
    </div>
  );
}

/** Payments in the currencies merchants price in, cycled through the feed. */
const FINAL_PAYMENTS = [
  "S$1,750.00",
  "€159.99",
  "¥24,300",
  "R$1,150.95",
  "$243.04",
  "RM1,435.90",
  "฿8,200.00",
  "£96.50",
] as const;

const FEED_ROWS = 5;
const FEED_INTERVAL_MS = 1_800;

/**
 * A stat card beside a feed of payments that cannot be reversed. Every tick a
 * payment enters at the top and the list shifts down one row, the oldest
 * dropping out of the bottom; the top edge fades so each arrival eases in.
 *
 * The shift is one CSS keyframe replayed by re-keying the list, so the rows
 * themselves never animate individually.
 */
function ChargebackVisual() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), FEED_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  // One extra row below the window, so the shift has something to push out.
  const rows = Array.from({ length: FEED_ROWS + 1 }, (_, index) => {
    const position =
      (((tick - index) % FINAL_PAYMENTS.length) + FINAL_PAYMENTS.length) % FINAL_PAYMENTS.length;
    return { id: tick - index, amount: FINAL_PAYMENTS[position] };
  });

  return (
    <div class="grid w-full items-center gap-6 sm:grid-cols-[auto_1fr]">
      <div class="rounded-lg border border-line bg-paper px-5 py-4 shadow-sm">
        <p class="text-sm text-slate-600">Chargebacks</p>
        <p class="mt-1 flex items-center gap-2 text-2xl font-medium text-ink">
          $0 <TrendUp />
        </p>
      </div>
      <div class="h-62 overflow-hidden border-l border-dashed border-line pl-4 [--feed-step:3.125rem] mask-[linear-gradient(to_bottom,transparent,black_45%)]">
        <ul
          key={tick}
          class="space-y-2.5 text-xs motion-safe:animate-[feed-shift_600ms_var(--ease-out-expo)] md:text-sm"
        >
          {rows.map((row, index) => (
            <li
              key={row.id}
              class="flex h-10 items-center justify-between gap-3 rounded-md border border-line bg-paper px-3 shadow-sm"
            >
              <span class="text-slate-600">
                Payment <strong class="font-medium text-ink">{row.amount}</strong> is
              </span>
              <span
                class={clsx(
                  "rounded bg-v2-sage px-2 py-0.5 text-forest",
                  index === 0 && "motion-safe:animate-[fade-in_400ms_300ms_both]",
                )}
              >
                Final
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

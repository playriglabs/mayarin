import type { ComponentChildren } from "preact";
import { Reveal } from "../reveal.tsx";
import { SectionIntro } from "./ui.tsx";
import { useEntryTimeline } from "./use-entry-timeline.ts";

/**
 * What a merchant pays and what protects the account. Every line is something
 * the code does today: the fee is the protocol fee plus the relayer gas fee, and
 * the 2FA is the authenticator-app step-up the dashboard API enforces before
 * money moves. No audit or certification is claimed.
 */
export function Security() {
  return (
    <section id="security" class="mx-auto w-full max-w-300 px-5 py-20 md:px-10 md:py-28">
      <Reveal>
        <SectionIntro
          label="Fees and security"
          title={
            <>
              Low fees. <span>Security-grade</span> by design.
            </>
          }
        >
          You keep almost all of every payment, and no single stolen password or key can move it.
        </SectionIntro>
      </Reveal>

      <div class="mt-12 grid gap-3 md:mt-16 lg:grid-cols-3">
        <Reveal class="h-full">
          <Card title="Low fees" tag="0.5%" visual={<FeeBar />}>
            <p>
              A 0.5% protocol fee per payment, plus a small network-gas fee with a floor per chain
              so small payments still cover their cost. Around 0.6% all in on larger payments.
            </p>
          </Card>
        </Reveal>

        <Reveal delay={90} class="h-full lg:col-span-2">
          <Card title="Two-factor sign-in" visual={<CodeBoxes />}>
            <p>
              Authenticator-app 2FA on every account, with ten one-time recovery codes. A fresh code
              is asked again before withdrawals, payouts, new API keys and webhook changes, and an
              API key can never move funds. The secret is encrypted at rest, so a database leak
              alone cannot generate codes.
            </p>
          </Card>
        </Reveal>

        <Reveal class="h-full">
          <Card title="Industrial-grade key security" visual={<KeyVault />}>
            <p>
              Signing keys live in a hardware-backed key vault, never in app config, and mainnet
              refuses a raw private key. The order signer and the operator use separate keys, and
              the treasury is a multisig Safe.
            </p>
          </Card>
        </Reveal>

        <Reveal delay={90} class="h-full">
          <Card title="Non-custodial settlement" visual={<SettlementSplit />}>
            <p>
              Settlements land in a wallet you control. Mayarin's fee goes to a separate treasury
              Safe, never into yours.
            </p>
          </Card>
        </Reveal>

        <Reveal delay={180} class="h-full">
          <Card title="Confirmed on-chain" visual={<ConfirmSteps />}>
            <p>
              A webhook is a signal, not proof. Mayarin checks every payment on-chain itself before
              it settles, so a spoofed or replayed notification cannot pay anyone.
            </p>
          </Card>
        </Reveal>
      </div>
    </section>
  );
}

function Card({
  title,
  tag,
  visual,
  children,
}: {
  readonly title: string;
  readonly tag?: string;
  readonly visual?: ComponentChildren;
  readonly children: ComponentChildren;
}) {
  return (
    <article class="flex h-full flex-col rounded-2xl border border-line bg-paper p-6 md:p-8">
      <div class="flex items-start justify-between gap-4">
        <h3 class="text-[clamp(1.4rem,2vw,1.75rem)]">{title}</h3>
        {tag && (
          <span class="rounded-full bg-v2-sky px-3 py-1 text-sm font-medium text-brand">{tag}</span>
        )}
      </div>
      {visual && <div class="mt-8">{visual}</div>}
      <div class="mt-auto pt-8 text-base leading-relaxed text-slate-600">{children}</div>
    </article>
  );
}

const CODE = ["4", "8", "1", "9", "0", "7"] as const;
const STEP_UP_MOMENTS = ["Sign-in", "Withdrawals", "Payouts", "API keys", "Webhooks"] as const;

/**
 * An authenticator code, the 30-second window it lives in, and the moments the
 * dashboard asks for a fresh one. Each loop a new code lands, the window drains
 * and every protected moment is checked off in turn.
 */
function CodeBoxes() {
  const root = useEntryTimeline<HTMLDivElement>((timeline) => {
    const digits = root.current?.querySelectorAll("[data-digit]") ?? [];
    timeline
      .call(() => {
        for (const digit of digits) digit.textContent = String(Math.floor(Math.random() * 10));
      })
      .from("[data-digit]", { autoAlpha: 0, y: -10, duration: 0.35, stagger: 0.08 })
      .fromTo("[data-window]", { width: "100%" }, { width: "10%", duration: 3, ease: "none" }, 0.5)
      .from("[data-moment]", { autoAlpha: 0.35, duration: 0.3, stagger: 0.3 }, 0.9)
      .from("[data-check]", { scale: 0, duration: 0.35, ease: "back.out(3)", stagger: 0.3 }, 0.9);
  });

  return (
    <div
      ref={root}
      class="rounded-xl border border-line bg-v2-sky/40 p-4 md:p-5"
      aria-hidden="true"
    >
      <div class="flex items-center justify-between text-xs text-slate-600">
        <span>Authenticator code</span>
        <span class="text-brand">New code every 30s</span>
      </div>
      <div class="mt-3 flex items-center gap-2">
        {CODE.map((digit, index) => (
          <span
            key={index}
            data-digit
            class="grid size-11 flex-1 place-items-center rounded-lg border border-line bg-paper text-lg font-medium text-ink md:max-w-14"
          >
            {digit}
          </span>
        ))}
      </div>
      <div class="mt-4 h-1 overflow-hidden rounded-full bg-line">
        <span data-window class="block h-full w-2/3 rounded-full bg-brand" />
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        {STEP_UP_MOMENTS.map((moment) => (
          <span
            key={moment}
            data-moment
            class="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 text-xs text-ink"
          >
            <svg
              data-check
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="size-3 text-brand"
              aria-hidden="true"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            {moment}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A $100 payment: the bar fills to nearly all of it, then the small fee lands. */
function FeeBar() {
  const root = useEntryTimeline<HTMLDivElement>((timeline) => {
    timeline
      .from("[data-keep]", {
        scaleX: 0,
        transformOrigin: "left",
        duration: 1.2,
        ease: "power3.out",
      })
      .from(
        "[data-fee]",
        { autoAlpha: 0, scaleY: 0.4, duration: 0.4, ease: "back.out(3)" },
        "-=0.1",
      )
      .from("[data-fee-label]", { autoAlpha: 0, y: 6, duration: 0.4, stagger: 0.15 }, "-=0.3");
  });

  return (
    <div ref={root} aria-hidden="true">
      <div class="flex h-11 overflow-hidden rounded-lg">
        <span data-keep class="flex-1 bg-v2-sky" />
        <span data-fee class="w-[3%] bg-brand" />
      </div>
      <div class="mt-3 flex justify-between text-xs text-slate-600">
        <span data-fee-label>You keep 99.4%</span>
        <span data-fee-label class="text-brand">
          Fee 0.6%
        </span>
      </div>
    </div>
  );
}

const ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.5",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
} as const;

function LockIcon() {
  return (
    <svg {...ICON} class="size-4" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** Two separate keys, each held by the vault rather than the app. */
function KeyVault() {
  const root = useEntryTimeline<HTMLDivElement>((timeline) => {
    timeline
      .from("[data-key]", { autoAlpha: 0, x: -24, duration: 0.5, stagger: 0.2 })
      .from(
        "[data-lock]",
        { scale: 0, rotate: -25, duration: 0.45, ease: "back.out(3)", stagger: 0.2 },
        0.3,
      )
      .from("[data-vault]", { autoAlpha: 0, duration: 0.4, stagger: 0.2 }, 0.6);
  });

  return (
    <div ref={root} class="space-y-2" aria-hidden="true">
      {["Order signer", "Operator"].map((name) => (
        <div
          key={name}
          data-key
          class="flex items-center gap-3 rounded-lg border border-line bg-v2-sky/60 px-3 py-2.5 text-xs text-ink"
        >
          <span data-lock class="text-brand">
            <LockIcon />
          </span>
          {name}
          <span data-vault class="ml-auto text-slate-600">
            Key vault
          </span>
        </div>
      ))}
    </div>
  );
}

function Node({ label, strong = false }: { readonly label: string; readonly strong?: boolean }) {
  return (
    <span
      class={
        strong
          ? "rounded-lg bg-brand px-3 py-2 text-xs font-medium text-paper"
          : "rounded-lg border border-line bg-v2-sky/60 px-3 py-2 text-xs text-ink"
      }
    >
      {label}
    </span>
  );
}

/**
 * The payment goes to the merchant's wallet; the fee goes somewhere else. A coin
 * leaves the payer, lands in the wallet, then the treasury takes its share.
 */
function SettlementSplit() {
  const root = useEntryTimeline<HTMLDivElement>((timeline) => {
    timeline
      .from("[data-payer]", { autoAlpha: 0, x: -16, duration: 0.4 })
      .from("[data-line]", { scaleX: 0, transformOrigin: "left", duration: 0.5 }, "-=0.1")
      .fromTo(
        "[data-coin]",
        { left: "0%", autoAlpha: 1 },
        { left: "100%", duration: 0.9, ease: "power1.inOut" },
      )
      .to("[data-coin]", { autoAlpha: 0, duration: 0.2 })
      .from("[data-wallet]", { scale: 0.85, duration: 0.5, ease: "back.out(3)" }, "-=0.2")
      .from("[data-treasury]", { autoAlpha: 0, x: 12, duration: 0.4 }, "-=0.2");
  });

  return (
    <div ref={root} class="flex items-center justify-between gap-2" aria-hidden="true">
      <span data-payer class="inline-flex">
        <Node label="Payer" />
      </span>
      <span class="relative h-px flex-1">
        <span data-line class="absolute inset-0 bg-brand/30" />
        <span
          data-coin
          class="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand opacity-0"
        />
      </span>
      <div class="flex flex-col gap-2">
        <span data-wallet class="inline-flex">
          <Node label="Your wallet" strong />
        </span>
        <span data-treasury class="inline-flex">
          <Node label="Treasury Safe" />
        </span>
      </div>
    </div>
  );
}

/**
 * A webhook only wakes the check; the on-chain read is what settles. The check
 * pings while it reads the chain, and only then does the line reach "Settled".
 */
function ConfirmSteps() {
  const root = useEntryTimeline<HTMLDivElement>((timeline) => {
    timeline
      .from("[data-webhook]", { autoAlpha: 0, x: -16, duration: 0.4 })
      .from("[data-signal]", { scaleX: 0, transformOrigin: "left", duration: 0.4 })
      .from("[data-check-node]", { autoAlpha: 0, scale: 0.7, duration: 0.4, ease: "back.out(3)" })
      .fromTo(
        "[data-ping]",
        { scale: 1, autoAlpha: 0.5 },
        { scale: 1.6, autoAlpha: 0, duration: 0.7, repeat: 1, ease: "power1.out" },
      )
      .from("[data-proof]", { scaleX: 0, transformOrigin: "left", duration: 0.4 })
      .from("[data-settled-node]", {
        autoAlpha: 0,
        scale: 0.7,
        duration: 0.4,
        ease: "back.out(3)",
      });
  });

  return (
    <div ref={root} class="flex items-center justify-between gap-2" aria-hidden="true">
      <span data-webhook class="inline-flex">
        <Node label="Webhook" />
      </span>
      <span data-signal class="h-px flex-1 border-t border-dashed border-brand/40" />
      <span data-check-node class="relative inline-flex">
        <span data-ping class="absolute inset-0 rounded-lg bg-brand opacity-0" />
        <Node label="On-chain check" strong />
      </span>
      <span data-proof class="h-px flex-1 bg-brand/30" />
      <span data-settled-node class="inline-flex">
        <Node label="Settled" />
      </span>
    </div>
  );
}

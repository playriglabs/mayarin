import type { ComponentChildren } from "preact";
import { Reveal } from "../reveal.tsx";
import { SectionIntro } from "./ui.tsx";

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

/**
 * An authenticator code, the 30-second window it lives in, and the moments the
 * dashboard asks for a fresh one.
 */
function CodeBoxes() {
  return (
    <div class="rounded-xl border border-line bg-v2-sky/40 p-4 md:p-5" aria-hidden="true">
      <div class="flex items-center justify-between text-xs text-slate-600">
        <span>Authenticator code</span>
        <span class="text-brand">New code every 30s</span>
      </div>
      <div class="mt-3 flex items-center gap-2">
        {["4", "8", "1", "9", "0", "7"].map((digit, index) => (
          <span
            key={index}
            class="grid size-11 flex-1 place-items-center rounded-lg border border-line bg-paper text-lg font-medium text-ink md:max-w-14"
          >
            {digit}
          </span>
        ))}
      </div>
      <div class="mt-4 h-1 overflow-hidden rounded-full bg-line">
        <span class="block h-full w-2/3 rounded-full bg-brand" />
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        {["Sign-in", "Withdrawals", "Payouts", "API keys", "Webhooks"].map((moment) => (
          <span
            key={moment}
            class="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 text-xs text-ink"
          >
            <svg
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

/** A $100 payment: nearly all of the bar reaches the merchant. */
function FeeBar() {
  return (
    <div aria-hidden="true">
      <div class="flex h-11 overflow-hidden rounded-lg">
        <span class="flex-1 bg-v2-sky" />
        <span class="w-[3%] bg-brand" />
      </div>
      <div class="mt-3 flex justify-between text-xs text-slate-600">
        <span>You keep 99.4%</span>
        <span class="text-brand">Fee 0.6%</span>
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
  return (
    <div class="space-y-2" aria-hidden="true">
      {["Order signer", "Operator"].map((name) => (
        <div
          key={name}
          class="flex items-center gap-3 rounded-lg border border-line bg-v2-sky/60 px-3 py-2.5 text-xs text-ink"
        >
          <span class="text-brand">
            <LockIcon />
          </span>
          {name}
          <span class="ml-auto text-slate-600">Key vault</span>
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

/** The payment goes to the merchant's wallet; the fee goes somewhere else. */
function SettlementSplit() {
  return (
    <div class="flex items-center justify-between gap-2" aria-hidden="true">
      <Node label="Payer" />
      <span class="h-px flex-1 bg-brand/30" />
      <div class="flex flex-col gap-2">
        <Node label="Your wallet" strong />
        <Node label="Treasury Safe" />
      </div>
    </div>
  );
}

/** A webhook only wakes the check; the on-chain read is what settles. */
function ConfirmSteps() {
  return (
    <div class="flex items-center justify-between gap-2" aria-hidden="true">
      <Node label="Webhook" />
      <span class="h-px flex-1 border-t border-dashed border-brand/40" />
      <Node label="On-chain check" strong />
      <span class="h-px flex-1 bg-brand/30" />
      <Node label="Settled" />
    </div>
  );
}

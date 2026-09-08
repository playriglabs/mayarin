import clsx from "clsx";
import type { ComponentChildren } from "preact";
import type { CapabilityKind } from "./capabilities.tsx";
import { networkName, RailMark } from "./rail-mark.tsx";
import { Check } from "./ui.tsx";

/**
 * What each card shows at rest. Deliberately flat and small: they are read for
 * a second before the code replaces them, so a scene that needs studying would
 * be a scene nobody finishes.
 */
export function CapabilityVisual({ kind }: { readonly kind: CapabilityKind }) {
  if (kind === "accept") {
    return (
      <Frame>
        <div class="w-full max-w-95 rounded-2xl bg-paper p-6 shadow-[0_18px_50px_#142b1612]">
          <div class="flex items-start justify-between gap-4 text-center">
            <div class="flex-1 [&_p]:mt-1 [&_p]:text-[10px] [&_p]:text-slate [&_strong]:mt-3 [&_strong]:block [&_strong]:text-xs [&_strong]:font-medium">
              <span class="mx-auto flex size-9 items-center justify-center">
                <RailMark asset="ETH" chain="base" size={36} />
              </span>
              <strong>Ayu Pratama</strong>
              <p>ETH · Base</p>
            </div>

            {/* Solid to the clearing layer, dashed onward: what has happened, then what it becomes. */}
            <div class="mt-1 flex flex-1 items-center" aria-hidden="true">
              <span class="h-px flex-1 bg-line" />
              <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-paper">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4 12h14M13 6l6 6-6 6" />
                </svg>
              </span>
              <span class="h-px flex-1 border-t border-dashed border-line" />
            </div>

            <div class="flex-1 [&_p]:mt-1 [&_p]:text-[10px] [&_p]:text-slate [&_strong]:mt-3 [&_strong]:block [&_strong]:text-xs [&_strong]:font-medium">
              <span class="mx-auto flex size-9 items-center justify-center rounded-full bg-v2-sage text-sm font-medium text-forest">
                S
              </span>
              <strong>Studio Supply</strong>
              <p>Settles USDC</p>
            </div>
          </div>

          <div class="mt-6 rounded-xl bg-v2-sage/60 px-5 py-6 text-center">
            <span class="mx-auto flex size-8 items-center justify-center rounded-full bg-v2-sage text-forest">
              <Check />
            </span>
            <p class="mt-3 text-xs font-medium text-ink">Equivalent in local currency</p>
            <strong class="mt-1 block text-2xl font-medium tracking-tight">Rp 1.500.000</strong>
          </div>
        </div>
      </Frame>
    );
  }

  if (kind === "route") {
    return (
      <Frame>
        <div class="w-full max-w-70 space-y-2">
          {[
            { asset: "ETH", chain: "base", selected: true },
            { asset: "EURC", chain: "arbitrum", selected: false },
            { asset: "EURC", chain: "arc-testnet", selected: false },
          ].map((rail) => (
            <div
              key={`${rail.asset}-${rail.chain}`}
              class="flex items-center gap-3 rounded-lg border border-line bg-paper p-3 text-xs"
            >
              <RailMark asset={rail.asset} chain={rail.chain} size={28} />
              <div>
                <p>{rail.asset}</p>
                <p class="text-[10px] text-slate">{networkName(rail.chain)}</p>
              </div>
              <span
                class={clsx(
                  "ml-auto size-3 rounded-full",
                  rail.selected ? "border-[3px] border-forest" : "border border-slate/40",
                )}
              />
            </div>
          ))}
          <p class="pt-1 text-center text-[10px] text-slate">All priced into USDC</p>
        </div>
      </Frame>
    );
  }

  if (kind === "settle") {
    return (
      <Frame>
        <div class="w-full max-w-70 rounded-xl border border-line bg-paper p-5 text-center shadow-[0_12px_40px_#142b1610]">
          <span class="mx-auto flex size-9 items-center justify-center">
            <RailMark asset="USDC" chain="base" size={36} />
          </span>
          <p class="mt-3 text-[10px] text-slate">Settled to your wallet</p>
          <strong class="mt-2 block text-2xl font-medium tracking-tight">1,500.00 USDC</strong>
          <div class="my-5 h-px bg-line" />
          <div class="space-y-2 text-left text-[11px] [&>div]:flex [&>div]:items-center [&>div]:justify-between [&_span]:text-slate">
            <div>
              <span>Debit · Clearing</span>
              <strong>1,500.00</strong>
            </div>
            <div>
              <span>Credit · Merchant</span>
              <strong>1,500.00</strong>
            </div>
          </div>
          <div class="mt-5 flex items-center justify-center gap-2 rounded-lg bg-v2-sage p-2.5 text-[11px] text-forest">
            <Check /> Ledger balanced
          </div>
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      <div class="w-full max-w-75 font-mono text-[10px]">
        {[
          { label: "Request", detail: "GET /premium/fx-quote", success: false },
          { label: "Terms", detail: "402 · $0.10 USDC · Base", success: false },
          { label: "Authorize", detail: "Sign the exact amount", success: false },
          { label: "Retry", detail: "PAYMENT-SIGNATURE: 0x…", success: false },
          { label: "Complete", detail: "200 OK · settlement queued", success: true },
        ].map((step, index, steps) => (
          <div key={step.label}>
            <div class="flex items-center gap-3 rounded-lg border border-line bg-paper px-3 py-2.5">
              <span class="w-18 shrink-0 text-slate">{step.label}</span>
              <span class={step.success ? "text-forest" : "text-ink"}>{step.detail}</span>
            </div>
            {index < steps.length - 1 && (
              <div class="flex h-4 items-center justify-center text-slate" aria-hidden="true">
                ↓
              </div>
            )}
          </div>
        ))}
        <p class="pt-3 text-center font-sans text-[10px] text-slate">
          Five steps. One signature. No account.
        </p>
      </div>
    </Frame>
  );
}

function Frame({ children }: { readonly children: ComponentChildren }) {
  return <div class="flex justify-center">{children}</div>;
}

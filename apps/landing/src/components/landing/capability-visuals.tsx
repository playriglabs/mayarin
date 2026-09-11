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
            <div class="flex-1 [&_p]:mt-1 [&_p]:text-[10px] [&_p]:text-slate-600 [&_strong]:mt-3 [&_strong]:block [&_strong]:text-xs [&_strong]:font-medium">
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

            <div class="flex-1 [&_p]:mt-1 [&_p]:text-[10px] [&_p]:text-slate-600 [&_strong]:mt-3 [&_strong]:block [&_strong]:text-xs [&_strong]:font-medium">
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
            { asset: "PYUSD", chain: "ethereum", selected: false },
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
                <p class="text-[10px] text-slate-600">{networkName(rail.chain)}</p>
              </div>
              <span
                class={clsx(
                  "ml-auto size-3 rounded-full",
                  rail.selected ? "border-[3px] border-forest" : "border border-slate/40",
                )}
              />
            </div>
          ))}
          <p class="pt-1 text-center text-[10px] text-slate-600">All priced into USDC</p>
        </div>
      </Frame>
    );
  }

  if (kind === "track") {
    return (
      <Frame>
        <div class="flex min-h-72 w-full max-w-70 flex-col rounded-xl border border-line bg-paper p-5 shadow-[0_12px_40px_#142b1610]">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-[11px] text-slate-600">Studio Supply · inv-2026-014</p>
              <strong class="mt-2 block text-2xl font-medium tracking-tight">1,500.00 USDC</strong>
            </div>
            <span class="rounded-full bg-v2-sage px-3 py-1 text-[11px] text-forest">Settled</span>
          </div>
          <div class="my-5 h-px bg-line" />
          <ol class="relative flex flex-1 flex-col justify-between gap-4 text-xs before:absolute before:top-2.5 before:bottom-2.5 before:left-[9.5px] before:w-px before:bg-forest/20">
            {[
              { step: "Price locked", time: "10:02" },
              { step: "Asset received", time: "10:03" },
              { step: "Cleared", time: "10:03" },
              { step: "Settled to wallet", time: "10:04" },
            ].map((item) => (
              <li key={item.step} class="flex items-center gap-3">
                <span class="relative flex size-5 items-center justify-center rounded-full bg-v2-sage text-forest [&_svg]:size-3">
                  <Check />
                </span>
                <span>{item.step}</span>
                <span class="ml-auto text-slate-600">{item.time}</span>
              </li>
            ))}
          </ol>
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      <div class="min-h-72 w-full max-w-70 rounded-xl border border-line bg-paper p-5 text-center shadow-[0_12px_40px_#142b1610]">
        <span class="mx-auto flex size-9 items-center justify-center">
          <RailMark asset="USDC" chain="base" size={36} />
        </span>
        <p class="mt-3 text-[10px] text-slate-600">Settled to your wallet</p>
        <strong class="mt-2 block text-2xl font-medium tracking-tight">1,500.00 USDC</strong>
        <div class="my-5 h-px bg-line" />
        <div class="space-y-2 text-left text-[11px] [&>div]:flex [&>div]:items-center [&>div]:justify-between [&_span]:text-slate-600">
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

function Frame({ children }: { readonly children: ComponentChildren }) {
  return <div class="flex w-full min-w-0 justify-center">{children}</div>;
}

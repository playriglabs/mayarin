/**
 * Per-network payment settings: what a payer may send on each network, and
 * what the merchant is paid in there.
 *
 * Built to stay readable as networks and assets grow. Each network is one
 * summary line — what it settles in, how many assets it takes — and its asset
 * picker opens only when edited, so fifteen chains are fifteen lines rather
 * than a wall of toggles. Everything listed comes from the deployment
 * (`supported`), never from a list in this file: a chain or stablecoin added to
 * the deployment appears here without a UI change.
 */

import { chainLabel } from "@mayarin/chain";
import { CaretDownIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { AssetLabel, AssetLogo, AssetStack } from "@/components/asset-logo";
import { ChainLabel } from "@/components/chain-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  type SelectOption,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { SupportedChainDto } from "@/types/settings";

/** The four draft fields this section edits. */
export interface NetworkDraft {
  readonly settlementAsset: string;
  readonly settlementAssetByChain: Readonly<Record<string, string>>;
  readonly acceptedAssets: readonly string[];
  readonly acceptedAssetsByChain: Readonly<Record<string, readonly string[]>>;
}

/** A search box appears once a list is longer than this. */
const SEARCH_FROM = 8;

/**
 * Every stablecoin any network carries: the default settlement asset's choices.
 * The current choice is kept in the list, so the field never renders blank
 * while the networks are loading.
 */
export function settlementOptionsOf(
  supported: readonly SupportedChainDto[],
  current?: string,
): SelectOption[] {
  const assets = [
    ...new Set([
      ...supported.flatMap((entry) => entry.settlementAssets),
      ...(current === undefined ? [] : [current]),
    ]),
  ].sort();
  return assets.map((asset) => ({ value: asset, label: asset }));
}

/** What the merchant is paid in on one chain. */
export function settlementOn(draft: NetworkDraft, chain: string): string {
  return draft.settlementAssetByChain[chain] ?? draft.settlementAsset;
}

/**
 * What the merchant accepts on one chain: their row if they have written one,
 * the merchant-wide list otherwise. An empty merchant-wide list means "no
 * preference", which the catalog reads as everything this chain can receive.
 */
export function acceptedOn(
  draft: NetworkDraft,
  chain: string,
  supported: readonly string[],
): readonly string[] {
  const row = draft.acceptedAssetsByChain[chain];
  if (row !== undefined && row.length > 0) {
    return row.filter((asset) => supported.includes(asset));
  }
  return inheritedOn(draft, supported);
}

function inheritedOn(draft: NetworkDraft, supported: readonly string[]): readonly string[] {
  return draft.acceptedAssets.length === 0
    ? supported
    : supported.filter((asset) => draft.acceptedAssets.includes(asset));
}

function sameAssets(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((asset) => right.includes(asset));
}

/**
 * Sets one chain's accepted list. Matching the inherited set removes the row,
 * so "inherit" keeps exactly one representation.
 */
function withAccepted(
  draft: NetworkDraft,
  chain: string,
  next: readonly string[],
  supported: readonly string[],
): Readonly<Record<string, readonly string[]>> {
  const byChain = { ...draft.acceptedAssetsByChain };
  if (sameAssets(next, inheritedOn(draft, supported))) {
    delete byChain[chain];
  } else {
    byChain[chain] = next;
  }
  return byChain;
}

/** Picking the default again removes the override, for the same reason. */
function withSettlement(
  draft: NetworkDraft,
  chain: string,
  asset: string,
): Readonly<Record<string, string>> {
  const byChain = { ...draft.settlementAssetByChain };
  if (asset === draft.settlementAsset) {
    delete byChain[chain];
  } else {
    byChain[chain] = asset;
  }
  return byChain;
}

/**
 * Copies one network's choices onto every other network, as far as each can
 * take them: the assets it also carries, and the settlement asset where it has
 * that stablecoin. A network that carries none of the chosen assets keeps its
 * own list rather than being left accepting nothing.
 */
export function applyToAll(
  draft: NetworkDraft,
  from: string,
  supported: readonly SupportedChainDto[],
): NetworkDraft {
  const source = supported.find((entry) => entry.chain === from);
  if (source === undefined) return draft;
  const accepted = acceptedOn(draft, from, source.assets);
  const settles = settlementOn(draft, from);

  let next = draft;
  for (const entry of supported) {
    if (entry.chain === from) continue;
    const here = accepted.filter((asset) => entry.assets.includes(asset));
    if (here.length > 0) {
      next = {
        ...next,
        acceptedAssetsByChain: withAccepted(next, entry.chain, here, entry.assets),
      };
    }
    if (entry.settlementAssets.includes(settles)) {
      next = {
        ...next,
        settlementAssetByChain: withSettlement(next, entry.chain, settles),
      };
    }
  }
  return next;
}

export function NetworkSettings({
  supported,
  draft,
  onChange,
}: {
  readonly supported: readonly SupportedChainDto[];
  readonly draft: NetworkDraft;
  readonly onChange: (next: NetworkDraft) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const shown =
    needle === ""
      ? supported
      : supported.filter(
          (entry) =>
            chainLabel(entry.chain).toLowerCase().includes(needle) ||
            entry.assets.some((asset) => asset.toLowerCase().includes(needle)),
        );

  return (
    <div className="flex flex-col gap-3">
      {supported.length > SEARCH_FROM && (
        <div className="relative">
          <MagnifyingGlassIcon
            size={16}
            aria-hidden="true"
            className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search networks or assets"
            aria-label="Search networks or assets"
            className="pl-9"
          />
        </div>
      )}

      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {shown.map((entry) => (
          <NetworkRow
            key={entry.chain}
            entry={entry}
            supported={supported}
            draft={draft}
            onChange={onChange}
            open={open === entry.chain}
            onToggle={() => setOpen((current) => (current === entry.chain ? null : entry.chain))}
          />
        ))}
        {shown.length === 0 && (
          <li className="p-4 text-muted-foreground text-sm">No network matches “{query}”.</li>
        )}
      </ul>
    </div>
  );
}

function NetworkRow({
  entry,
  supported,
  draft,
  onChange,
  open,
  onToggle,
}: {
  readonly entry: SupportedChainDto;
  readonly supported: readonly SupportedChainDto[];
  readonly draft: NetworkDraft;
  readonly onChange: (next: NetworkDraft) => void;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const [assetQuery, setAssetQuery] = useState("");
  const chain = entry.chain;
  const settlesIn = settlementOn(draft, chain);
  const accepted = [...new Set([settlesIn, ...acceptedOn(draft, chain, entry.assets)])].filter(
    (asset) => entry.assets.includes(asset),
  );
  const customized =
    draft.acceptedAssetsByChain[chain] !== undefined ||
    draft.settlementAssetByChain[chain] !== undefined;
  const settlementChoices: SelectOption[] = entry.settlementAssets.map((asset) => ({
    value: asset,
    label: asset,
  }));
  // A default the network does not carry cannot settle here, and the row says
  // so rather than showing a choice that would drop every rail.
  const settleable = entry.settlementAssets.includes(settlesIn);

  // The settlement asset first, the rest alphabetically, so an asset sits in
  // the same place on every network.
  const assetNeedle = assetQuery.trim().toLowerCase();
  const assets = [...entry.assets]
    .sort((x, y) => (x === settlesIn ? -1 : y === settlesIn ? 1 : x.localeCompare(y)))
    .filter((asset) => assetNeedle === "" || asset.toLowerCase().includes(assetNeedle));
  const panelId = `network-${chain}`;

  function toggle(asset: string, on: boolean) {
    const current = acceptedOn(draft, chain, entry.assets);
    const next = on ? [...new Set([...current, asset])] : current.filter((a) => a !== asset);
    onChange({ ...draft, acceptedAssetsByChain: withAccepted(draft, chain, next, entry.assets) });
  }

  function reset() {
    const acceptedByChain = { ...draft.acceptedAssetsByChain };
    const settlementByChain = { ...draft.settlementAssetByChain };
    delete acceptedByChain[chain];
    delete settlementByChain[chain];
    onChange({
      ...draft,
      acceptedAssetsByChain: acceptedByChain,
      settlementAssetByChain: settlementByChain,
    });
  }

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {/* Stacked on a phone — the network, then what it does — and one line
            from `sm` up. The caret keeps its own column either way, so it never
            floats between the two. */}
        <span className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <span className="font-medium text-sm sm:min-w-44 sm:flex-1">
            <ChainLabel chain={chain} className="whitespace-nowrap" />
          </span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground text-xs">
            <span className="flex items-center gap-2">
              Settles in
              {settleable ? (
                <span className="text-foreground">
                  <AssetLabel symbol={settlesIn} size={16} />
                </span>
              ) : (
                <Badge variant="warning">Not available</Badge>
              )}
            </span>
            <span className="flex items-center gap-2">
              <AssetStack assets={accepted} size={18} />
              {accepted.length} of {entry.assets.length} accepted
            </span>
            {customized && <Badge variant="brand">Custom</Badge>}
          </span>
        </span>
        <CaretDownIcon
          size={14}
          aria-hidden="true"
          className={cn("text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div id={panelId} className="flex flex-col gap-4 border-border border-t bg-muted/20 p-4">
          <div className="flex flex-col gap-2">
            <span className="font-medium text-xs">Payers can send</span>
            {entry.assets.length > SEARCH_FROM && (
              <Input
                value={assetQuery}
                onChange={(event) => setAssetQuery(event.target.value)}
                placeholder="Search assets"
                aria-label={`Search assets on ${chainLabel(chain)}`}
                className="h-8 max-w-60 text-xs"
              />
            )}
            <fieldset
              aria-label={`Assets accepted on ${chainLabel(chain)}`}
              className="m-0 flex flex-wrap gap-2 border-0 p-0"
            >
              {assets.map((asset) => {
                const on = accepted.includes(asset);
                // Each network keeps at least one asset, and always accepts
                // what it settles in.
                const locked = asset === settlesIn || (on && accepted.length === 1);
                return (
                  <button
                    key={asset}
                    type="button"
                    aria-pressed={on}
                    disabled={locked}
                    title={
                      asset === settlesIn
                        ? "A network always accepts what it settles in"
                        : locked
                          ? "Each network keeps at least one asset"
                          : undefined
                    }
                    onClick={() => toggle(asset, !on)}
                    className={cn(
                      "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
                      on
                        ? "border-brand bg-brand/10 text-foreground dark:border-electric dark:bg-electric/10"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <AssetLogo
                      symbol={asset}
                      size={16}
                      className={on ? "" : "opacity-50 grayscale"}
                    />
                    {asset}
                  </button>
                );
              })}
            </fieldset>
          </div>

          {settlementChoices.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="font-medium text-xs">You are paid in</span>
              <Select
                items={settlementChoices}
                value={settlesIn}
                onValueChange={(next) =>
                  onChange({
                    ...draft,
                    settlementAssetByChain: withSettlement(draft, chain, next),
                  })
                }
              >
                <SelectTrigger
                  aria-label={`Settlement asset on ${chainLabel(chain)}`}
                  className="h-9 w-48"
                >
                  <SelectValue
                    placeholder="Choose asset"
                    renderValue={(option) => <AssetLabel symbol={option.value} size={16} />}
                  />
                </SelectTrigger>
                <SelectContent>
                  {settlementChoices.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <AssetLabel symbol={option.value} size={16} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {supported.length > 1 && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onChange(applyToAll(draft, chain, supported))}
              >
                Apply to all networks
              </Button>
            )}
            {customized && (
              <Button type="button" variant="ghost" size="sm" onClick={reset}>
                Reset to default
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

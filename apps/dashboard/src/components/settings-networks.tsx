/**
 * Per-network payment settings: what a payer may send on each network, and
 * what the merchant is paid in there.
 *
 * Built to stay readable as networks and assets grow. Each network is one
 * summary line — what it settles in, how many assets it takes — and its asset
 * picker opens in a dialog only when edited, so fifteen chains are fifteen
 * lines rather than a wall of toggles. Everything listed comes from the deployment
 * (`supported`), never from a list in this file: a chain or stablecoin added to
 * the deployment appears here without a UI change.
 */

import { chainLabel } from "@mayarin/chain";
import { CaretRightIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { AssetLabel, AssetLogo, AssetStack } from "@/components/asset-logo";
import { ChainLabel } from "@/components/chain-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  // The chain outlives `open` so the dialog keeps its content while it fades out.
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
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
  const editingEntry = supported.find((entry) => entry.chain === editing);

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
            draft={draft}
            onOpen={() => {
              setEditing(entry.chain);
              setOpen(true);
            }}
          />
        ))}
        {shown.length === 0 && (
          <li className="p-4 text-muted-foreground text-sm">No network matches “{query}”.</li>
        )}
      </ul>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg">
          {editingEntry !== undefined && (
            <NetworkEditor
              key={editingEntry.chain}
              entry={editingEntry}
              supported={supported}
              draft={draft}
              onChange={onChange}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function isCustomized(draft: NetworkDraft, chain: string): boolean {
  return (
    draft.acceptedAssetsByChain[chain] !== undefined ||
    draft.settlementAssetByChain[chain] !== undefined
  );
}

/** What a network accepts, always including what it settles in. */
function acceptedWithSettlement(draft: NetworkDraft, entry: SupportedChainDto): readonly string[] {
  const settlesIn = settlementOn(draft, entry.chain);
  return [...new Set([settlesIn, ...acceptedOn(draft, entry.chain, entry.assets)])].filter(
    (asset) => entry.assets.includes(asset),
  );
}

function NetworkRow({
  entry,
  draft,
  onOpen,
}: {
  readonly entry: SupportedChainDto;
  readonly draft: NetworkDraft;
  readonly onOpen: () => void;
}) {
  const chain = entry.chain;
  const settlesIn = settlementOn(draft, chain);
  const accepted = acceptedWithSettlement(draft, entry);
  // A default the network does not carry cannot settle here, and the row says
  // so rather than showing a choice that would drop every rail.
  const settleable = entry.settlementAssets.includes(settlesIn);

  return (
    <li>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={onOpen}
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
            {isCustomized(draft, chain) && <Badge variant="brand">Custom</Badge>}
          </span>
        </span>
        <CaretRightIcon size={14} aria-hidden="true" className="text-muted-foreground" />
      </button>
    </li>
  );
}

/**
 * One network's choices, in a dialog. The asset list is a scrolling column of
 * checkboxes rather than a row of pills, so forty assets cost the same screen
 * as four; search and select-all/clear take over once the list gets long.
 * Edits land in the draft as they are made — the page's Save still commits.
 */
function NetworkEditor({
  entry,
  supported,
  draft,
  onChange,
}: {
  readonly entry: SupportedChainDto;
  readonly supported: readonly SupportedChainDto[];
  readonly draft: NetworkDraft;
  readonly onChange: (next: NetworkDraft) => void;
}) {
  const [query, setQuery] = useState("");
  const chain = entry.chain;
  const settlesIn = settlementOn(draft, chain);
  const settleable = entry.settlementAssets.includes(settlesIn);
  const accepted = acceptedWithSettlement(draft, entry);
  const customized = isCustomized(draft, chain);
  const settlementChoices: SelectOption[] = entry.settlementAssets.map((asset) => ({
    value: asset,
    label: asset,
  }));

  // The settlement asset first, the rest alphabetically, so an asset sits in
  // the same place on every network.
  const needle = query.trim().toLowerCase();
  const assets = [...entry.assets]
    .sort((x, y) => (x === settlesIn ? -1 : y === settlesIn ? 1 : x.localeCompare(y)))
    .filter((asset) => needle === "" || asset.toLowerCase().includes(needle));

  function setAccepted(next: readonly string[]) {
    onChange({ ...draft, acceptedAssetsByChain: withAccepted(draft, chain, next, entry.assets) });
  }

  function toggle(asset: string, on: boolean) {
    const current = acceptedOn(draft, chain, entry.assets);
    setAccepted(on ? [...new Set([...current, asset])] : current.filter((a) => a !== asset));
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
    <>
      <DialogHeader>
        <DialogTitle>
          <ChainLabel chain={chain} />
        </DialogTitle>
        <DialogDescription>
          What payers can send on this network, and what you are paid in.
        </DialogDescription>
      </DialogHeader>

      {settlementChoices.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="font-medium text-xs">You are paid in</span>
          <Select
            items={settlementChoices}
            value={settlesIn}
            onValueChange={(next) =>
              onChange({ ...draft, settlementAssetByChain: withSettlement(draft, chain, next) })
            }
          >
            <SelectTrigger aria-label={`Settlement asset on ${chainLabel(chain)}`} className="h-9">
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

      <div className="flex min-h-0 flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-xs">
            Payers can send{" "}
            <span className="text-muted-foreground">
              · {accepted.length} of {entry.assets.length}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={accepted.length === entry.assets.length}
              onClick={() => setAccepted(entry.assets)}
            >
              Select all
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              // Clearing keeps the settlement asset, so it needs one to keep.
              disabled={!settleable || accepted.length === 1}
              onClick={() => setAccepted([settlesIn])}
            >
              Clear
            </Button>
          </span>
        </div>

        {entry.assets.length > SEARCH_FROM && (
          <div className="relative">
            <MagnifyingGlassIcon
              size={14}
              aria-hidden="true"
              className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search assets"
              aria-label={`Search assets on ${chainLabel(chain)}`}
              className="h-9 pl-8"
            />
          </div>
        )}

        <ul
          aria-label={`Assets accepted on ${chainLabel(chain)}`}
          className="flex max-h-80 min-h-0 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border"
        >
          {assets.map((asset) => {
            const on = accepted.includes(asset);
            // Each network keeps at least one asset, and always accepts what
            // it settles in.
            const isSettlement = asset === settlesIn;
            const locked = isSettlement || (on && accepted.length === 1);
            const id = `accept-${chain}-${asset}`;
            return (
              <li key={asset}>
                <label
                  htmlFor={id}
                  title={
                    isSettlement
                      ? "A network always accepts what it settles in"
                      : locked
                        ? "Each network keeps at least one asset"
                        : undefined
                  }
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 text-sm transition-colors",
                    locked ? "cursor-not-allowed" : "cursor-pointer hover:bg-muted/40",
                  )}
                >
                  <Checkbox
                    id={id}
                    checked={on}
                    disabled={locked}
                    onCheckedChange={(checked) => toggle(asset, checked)}
                  />
                  <AssetLogo
                    symbol={asset}
                    size={20}
                    className={on ? "" : "opacity-50 grayscale"}
                  />
                  <span className={cn("flex-1", on ? "text-foreground" : "text-muted-foreground")}>
                    {asset}
                  </span>
                  {isSettlement && <Badge variant="brand">Settles here</Badge>}
                </label>
              </li>
            );
          })}
          {assets.length === 0 && (
            <li className="p-4 text-muted-foreground text-sm">No asset matches “{query}”.</li>
          )}
        </ul>
      </div>

      <DialogFooter className="flex-wrap items-center justify-between">
        <span className="flex items-center gap-2">
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
        </span>
        <DialogClose render={<Button type="button" size="sm" />}>Done</DialogClose>
      </DialogFooter>
    </>
  );
}

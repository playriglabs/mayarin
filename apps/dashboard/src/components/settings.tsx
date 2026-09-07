/**
 * Merchant settings — a React island over `/settings` (#95, #15).
 *
 * Two groups of fields that look alike and are not:
 *
 *   - Settlement: which stablecoin the merchant is paid in, what a payer may
 *     pay with, and the address the money is sent to. Changing the address
 *     redirects this merchant's money, which is why the surface has its own
 *     permission and every edit is written to an audit trail shown below.
 *   - Profile: city and country. Frozen into the snapshot every payment link
 *     and payment carries, so a buyer sees them; they move no money.
 *
 * `effectiveSettlementAddress` is where the money actually goes — what the
 * merchant chose, or their managed wallet when they chose nothing. It is shown
 * separately from the chosen address because "blank" is not "nowhere", and a
 * merchant should be able to read the answer rather than infer it.
 */

import { Tabs } from "@base-ui-components/react/tabs";
import { BankIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { match } from "ts-pattern";
import { AssetLabel } from "@/components/asset-logo";
import { ChainLabel } from "@/components/chain-logo";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  type ComboboxOption,
} from "@/components/ui/combobox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageLoader } from "@/components/ui/page-loader";
import { QueryError } from "@/components/ui/query-error";
import {
  Select,
  SelectContent,
  SelectItem,
  type SelectOption,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useMerchantRails,
  useSettings,
  useSettingsHistory,
  useUpdateSettings,
} from "@/hooks/settings";
import { useUrlTab } from "@/hooks/url-tab";
import { ApiError } from "@/lib/api/client";
import { COUNTRIES } from "@/lib/countries";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD } from "@/lib/icons";
import { withQuery } from "@/lib/with-query";
import type { SettingsDto } from "@/types/settings";

/** A merchant settles in a stablecoin — the domain refuses anything else. */
const SETTLEMENT_OPTIONS: readonly SelectOption[] = [
  { value: "USDC", label: "USDC" },
  { value: "USDT", label: "USDT" },
];

/**
 * Every country, with the unsupported ones disabled rather than hidden.
 *
 * `COUNTRIES` already sorts the selectable markets to the top, so the list a
 * merchant sees before typing is the list they can actually choose from.
 */
const COUNTRY_OPTIONS: readonly ComboboxOption[] = COUNTRIES.map((country) => ({
  value: country.code,
  label: country.label,
  ...(country.supported ? {} : { disabled: true }),
}));

interface Draft {
  readonly settlementAsset: string;
  readonly acceptedAssets: readonly string[];
  /**
   * Accepted assets narrowed per chain (#244).
   *
   * A chain absent inherits `acceptedAssets`, which is where every merchant
   * starts and where a merchant who never touches the matrix stays.
   */
  readonly acceptedAssetsByChain: Readonly<Record<string, readonly string[]>>;
  readonly settlementAddress: string;
  readonly city: string;
  readonly countryCode: string;
}

const SETTINGS_TABS = ["settlement", "profile", "history"] as const;
const HISTORY_PAGE_SIZE = 10;
type SettingsTab = (typeof SETTINGS_TABS)[number];

function draftOf(settings: SettingsDto): Draft {
  return {
    settlementAsset: settings.settlementAsset,
    acceptedAssets: settings.acceptedAssets,
    acceptedAssetsByChain: settings.acceptedAssetsByChain,
    settlementAddress: settings.settlementAddress ?? "",
    city: settings.city ?? "",
    countryCode: settings.countryCode ?? "",
  };
}

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load settings";
}

function networkReasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load payment networks";
}

/** Empty means "clear it", which the API spells `null` — absent would mean "leave it". */
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function sameAssets(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((asset) => right.includes(asset));
}

/**
 * Whether a typed settlement address is one the API will accept.
 *
 * Blank is valid — it means "pay me at my managed wallet". Checksum case is not
 * enforced, matching the domain: EIP-55 mixed case is a hint, and an
 * all-lowercase address copied from a block explorer is a correct address.
 */
function isValidSettlementAddress(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === "" || /^0x[0-9a-fA-F]{40}$/.test(trimmed);
}

function Settings() {
  const settings = useSettings();
  const history = useSettingsHistory();
  const rails = useMerchantRails();
  const update = useUpdateSettings();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  // Client-side paging: the history endpoint returns the whole audit trail at
  // once, so a page is a slice. Clamped against the live count, so a save that
  // appends a row cannot leave the pager pointing past the last page.
  const [historyPageInput, setHistoryPage] = useState(0);
  const historyChanges = history.data?.changes ?? [];
  const historyPages = Math.max(1, Math.ceil(historyChanges.length / HISTORY_PAGE_SIZE));
  const historyPage = Math.min(historyPageInput, historyPages - 1);
  // In the URL, so a reload — or a link a merchant sends a colleague — opens
  // the tab they were actually on.
  const [activeTab, setActiveTab] = useUrlTab<SettingsTab>("tab", SETTINGS_TABS, "settlement");

  // The server's copy is the source of truth; the draft is only what is being
  // typed. Reset when the loaded settings change so a successful save leaves
  // the form showing what was actually stored, not what was submitted.
  const loaded = settings.data?.settings;
  /** What each network can receive, so the matrix lists nothing a chain has no address for. */
  const supportedChains = rails.data?.supported ?? [];
  // Blocks the save rather than only colouring the field: the API probes every
  // chain for contract code before it validates, so a malformed address came
  // back as a provider fault instead of as the typo it is.
  const addressInvalid = draft !== null && !isValidSettlementAddress(draft.settlementAddress);
  useEffect(() => {
    if (loaded !== undefined) setDraft(draftOf(loaded));
  }, [loaded]);

  async function save() {
    if (draft === null) return;
    setFailure("");
    setNotice("");
    try {
      await update.mutateAsync({
        settlementAsset: draft.settlementAsset,
        acceptedAssets: draft.acceptedAssets,
        acceptedAssetsByChain: draft.acceptedAssetsByChain,
        settlementAddress: orNull(draft.settlementAddress),
        city: orNull(draft.city),
        countryCode: orNull(draft.countryCode),
      });
      setNotice("Settings saved.");
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not save settings");
    }
  }

  function edit(next: Draft) {
    setFailure("");
    setNotice("");
    setDraft(next);
  }

  /**
   * What this merchant accepts on one chain: their row if they have written
   * one, the merchant-wide list otherwise.
   */
  function acceptedOn(
    current: Draft,
    chain: string,
    supported: readonly string[],
  ): readonly string[] {
    const row = current.acceptedAssetsByChain[chain];
    if (row !== undefined && row.length > 0) {
      return row.filter((asset) => supported.includes(asset));
    }
    // An empty merchant-wide list means "no preference", which the catalog
    // reads as everything this chain can receive — so the boxes are ticked.
    return current.acceptedAssets.length === 0
      ? supported
      : supported.filter((asset) => current.acceptedAssets.includes(asset));
  }

  /**
   * Ticks or unticks one `(chain, asset)` box.
   *
   * Writing a row is what turns an inherited chain into an explicit one, so the
   * first tick materialises the row from what was inherited — otherwise
   * unticking ETH on Base would silently drop USDC with it. Unticking back to
   * the inherited set removes the row again, so "inherit" keeps exactly one
   * representation.
   */
  function toggleChainAsset(
    chain: string,
    asset: string,
    checked: boolean,
    supported: readonly string[],
  ) {
    if (draft === null) return;
    const current = acceptedOn(draft, chain, supported);
    const next = checked
      ? [...new Set([...current, asset])]
      : current.filter((entry) => entry !== asset);

    const byChain = { ...draft.acceptedAssetsByChain };
    const inherited =
      draft.acceptedAssets.length === 0
        ? supported
        : supported.filter((entry) => draft.acceptedAssets.includes(entry));
    if (sameAssets(next, inherited)) {
      // Matching the merchant-wide choice is inheritance, so keep one
      // representation rather than persisting a redundant override.
      delete byChain[chain];
    } else {
      byChain[chain] = next;
    }
    edit({ ...draft, acceptedAssetsByChain: byChain });
  }

  function resetChainAssets(chain: string) {
    if (draft === null) return;
    const byChain = { ...draft.acceptedAssetsByChain };
    delete byChain[chain];
    edit({ ...draft, acceptedAssetsByChain: byChain });
  }

  return (
    <section className="flex flex-col gap-8">
      {match(settings)
        .with({ isPending: true }, () => <PageLoader label="Loading settings" />)
        .with({ isError: true }, ({ error }) => (
          <QueryError
            message={reasonOf(error)}
            retry={() => void settings.refetch()}
            retrying={settings.isFetching}
          />
        ))
        .otherwise(() => {
          if (draft === null || loaded === undefined) return null;
          return (
            <>
              {failure !== "" && <Alert variant="destructive">{failure}</Alert>}
              {notice !== "" && <Alert role="status">{notice}</Alert>}

              <Tabs.Root
                value={activeTab}
                onValueChange={(value) => setActiveTab(value as SettingsTab)}
              >
                <Tabs.List
                  aria-label="Settings sections"
                  className="flex w-full overflow-x-auto border-border border-b"
                >
                  {(
                    [
                      ["settlement", "Settlement"],
                      ["profile", "Profile location"],
                      ["history", "Change history"],
                    ] as const
                  ).map(([value, label]) => (
                    <Tabs.Tab
                      key={value}
                      value={value}
                      className="min-h-11 shrink-0 cursor-pointer border-transparent border-b-2 px-4 font-sans text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-active:border-brand data-active:text-foreground dark:data-active:border-electric"
                    >
                      {label}
                    </Tabs.Tab>
                  ))}
                </Tabs.List>

                <Tabs.Panel value="settlement" className="pt-6 focus-visible:outline-none">
                  <Card className="flex flex-col gap-4 p-4">
                    <Field>
                      <FieldLabel htmlFor="settlement-asset">Settlement asset</FieldLabel>
                      <Select
                        items={SETTLEMENT_OPTIONS}
                        value={draft.settlementAsset}
                        onValueChange={(next) => edit({ ...draft, settlementAsset: next })}
                      >
                        <SelectTrigger id="settlement-asset">
                          <SelectValue
                            placeholder="Select an asset"
                            renderValue={(option) => <AssetLabel symbol={option.value} size={18} />}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {SETTLEMENT_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              <AssetLabel symbol={option.value} size={18} />
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        What you are paid in. Whatever a payer sends is converted to this before it
                        reaches you.
                      </FieldDescription>
                    </Field>

                    {/* Per network and nowhere else. One merchant-wide list
                        stopped describing anything the moment there were two
                        chains — Base can receive ETH and Arc cannot — so a
                        merchant ticking ETH was never saying they accept it
                        everywhere (#244). Showing both a global list and a
                        per-network one asked them to answer the same question
                        twice, so only the network cards remain. */}
                    {rails.isPending && (
                      <p role="status" className="text-muted-foreground text-sm">
                        Loading per-network asset options…
                      </p>
                    )}
                    {rails.isError && (
                      <QueryError
                        message={networkReasonOf(rails.error)}
                        retry={() => void rails.refetch()}
                        retrying={rails.isFetching}
                      />
                    )}
                    {/* Rendered for a single chain too, now that this is the
                        only place a payer asset can be chosen at all. */}
                    {!rails.isPending && !rails.isError && supportedChains.length > 0 && (
                      <Field>
                        <FieldLabel>Accepted assets per network</FieldLabel>
                        <div className="grid gap-3 pt-1 sm:grid-cols-2">
                          {supportedChains.map((entry) => {
                            const accepted = acceptedOn(draft, entry.chain, entry.assets);
                            const customized =
                              draft.acceptedAssetsByChain[entry.chain] !== undefined;
                            return (
                              <div
                                key={entry.chain}
                                className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <p className="font-medium text-sm">
                                    <ChainLabel chain={entry.chain} />
                                  </p>
                                  <span className="flex items-center gap-2">
                                    <Badge variant={customized ? "brand" : "default"}>
                                      {customized ? "Custom" : "Default"}
                                    </Badge>
                                    {customized && (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => resetChainAssets(entry.chain)}
                                      >
                                        Reset
                                      </Button>
                                    )}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-4">
                                  {entry.assets.map((asset) => (
                                    <span key={asset} className="flex items-center gap-2 text-sm">
                                      <Checkbox
                                        id={`accepted-${entry.chain}-${asset}`}
                                        checked={accepted.includes(asset)}
                                        disabled={accepted.length === 1 && accepted.includes(asset)}
                                        onCheckedChange={(checked) =>
                                          toggleChainAsset(
                                            entry.chain,
                                            asset,
                                            checked === true,
                                            entry.assets,
                                          )
                                        }
                                      />
                                      <label
                                        htmlFor={`accepted-${entry.chain}-${asset}`}
                                        className="mt-1"
                                      >
                                        <AssetLabel symbol={asset} size={18} />
                                      </label>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <FieldDescription>
                          Choose what payers can send on each network. Only assets a network can
                          receive are listed, and each keeps at least one.
                        </FieldDescription>
                      </Field>
                    )}

                    <Field>
                      <FieldLabel htmlFor="settlement-address">Settlement address</FieldLabel>
                      <Input
                        id="settlement-address"
                        value={draft.settlementAddress}
                        onChange={(e) => edit({ ...draft, settlementAddress: e.target.value })}
                        placeholder="0x…"
                        aria-invalid={addressInvalid}
                        aria-describedby="settlement-address-hint"
                        className="font-mono text-xs"
                      />
                      <FieldDescription id="settlement-address-hint">
                        Leave it blank to be paid at your managed wallet. There is no shared
                        default: one address for every merchant would pay every merchant into the
                        same wallet.
                      </FieldDescription>
                      {addressInvalid && (
                        <FieldError>
                          Enter a 20-byte hex address, e.g. 0x1234…abcd, or leave it blank.
                        </FieldError>
                      )}
                    </Field>

                    {/* Shown in full and never truncated in the DOM: an address a
                      merchant cannot copy whole is worse than one they scroll. */}
                    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
                      <BankIcon
                        size={ICON_CARD}
                        aria-hidden="true"
                        className="text-muted-foreground"
                      />
                      <span className="text-muted-foreground">Paid to</span>
                      <span className="break-all font-mono text-xs">
                        {loaded.effectiveSettlementAddress ?? "nowhere yet"}
                      </span>
                      <Badge variant={loaded.canSettleOnChain ? "success" : "warning"}>
                        {loaded.canSettleOnChain ? "Can settle on chain" : "No address"}
                      </Badge>
                    </div>
                  </Card>
                </Tabs.Panel>

                <Tabs.Panel value="profile" className="pt-6 focus-visible:outline-none">
                  <Card className="flex flex-col gap-4 p-4">
                    {/* One row: a city and a country are one fact — where the
                        merchant is — not two settings a reader hunts for. */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <FieldLabel htmlFor="merchant-city">City</FieldLabel>
                        <Input
                          id="merchant-city"
                          value={draft.city}
                          onChange={(e) => edit({ ...draft, city: e.target.value })}
                          placeholder="Jakarta"
                        />
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="merchant-country">Country</FieldLabel>
                        <Combobox
                          items={COUNTRY_OPTIONS}
                          value={draft.countryCode}
                          onValueChange={(next) => edit({ ...draft, countryCode: next })}
                        >
                          <ComboboxInput id="merchant-country" placeholder="Search a country" />
                          <ComboboxContent>
                            <ComboboxEmpty>No country matches that.</ComboboxEmpty>
                            <ComboboxList>
                              {(country: ComboboxOption) => (
                                <ComboboxItem
                                  key={country.value}
                                  value={country}
                                  {...(country.disabled === true ? { disabled: true } : {})}
                                >
                                  {country.label}
                                </ComboboxItem>
                              )}
                            </ComboboxList>
                          </ComboboxContent>
                        </Combobox>
                      </Field>
                    </div>
                    <FieldDescription>
                      Mayarin takes payments in the United States and Southeast Asia today. Every
                      other country is listed but cannot be picked yet. Both fields are frozen into
                      every payment a link takes, and a payment link cannot be created without them.
                    </FieldDescription>
                  </Card>
                </Tabs.Panel>

                <Tabs.Panel
                  value="history"
                  className="flex flex-col gap-4 pt-6 focus-visible:outline-none"
                >
                  <p className="text-sm text-muted-foreground">
                    Who changed what, and when. Append-only — a redirect of your money survives the
                    redirect itself.
                  </p>
                  {history.isPending ? (
                    <PageLoader label="Loading change history" />
                  ) : history.isError ? (
                    <QueryError
                      message={reasonOf(history.error)}
                      retry={() => void history.refetch()}
                      retrying={history.isFetching}
                    />
                  ) : historyChanges.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing has been changed yet.</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <Table>
                        <TableCaption>Settlement setting changes</TableCaption>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Field</TableHead>
                            <TableHead>From</TableHead>
                            <TableHead>To</TableHead>
                            <TableHead>Changed</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {historyChanges
                            .slice(
                              historyPage * HISTORY_PAGE_SIZE,
                              (historyPage + 1) * HISTORY_PAGE_SIZE,
                            )
                            .map((change) => (
                              <TableRow key={change.id}>
                                <TableCell className="font-mono text-xs">{change.field}</TableCell>
                                <TableCell className="break-all font-mono text-xs text-muted-foreground">
                                  {change.previousValue ?? "—"}
                                </TableCell>
                                <TableCell className="break-all font-mono text-xs">
                                  {change.nextValue ?? "—"}
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  <time dateTime={isoAttr(change.changedAt)}>
                                    {formatDateTime(change.changedAt)}
                                  </time>
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                      {historyPages > 1 && (
                        <nav
                          aria-label="Change history pages"
                          className="flex items-center justify-between gap-3"
                        >
                          <Button
                            variant="secondary"
                            onClick={() => setHistoryPage(historyPage - 1)}
                            disabled={historyPage === 0}
                          >
                            Previous
                          </Button>
                          <span className="font-mono text-xs text-muted-foreground">
                            Page {historyPage + 1} of {historyPages} · {historyChanges.length}{" "}
                            changes
                          </span>
                          <Button
                            variant="secondary"
                            onClick={() => setHistoryPage(historyPage + 1)}
                            disabled={historyPage >= historyPages - 1}
                          >
                            Next
                          </Button>
                        </nav>
                      )}
                    </div>
                  )}
                </Tabs.Panel>
              </Tabs.Root>

              {activeTab !== "history" && (
                <div className="flex justify-end">
                  <Button
                    onClick={save}
                    disabled={
                      update.isPending ||
                      addressInvalid ||
                      JSON.stringify(draft) === JSON.stringify(draftOf(loaded))
                    }
                  >
                    {update.isPending ? "Saving…" : "Save settings"}
                  </Button>
                </div>
              )}
            </>
          );
        })}
    </section>
  );
}

export default withQuery(Settings);

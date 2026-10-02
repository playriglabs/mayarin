/**
 * Merchant settings — a React island over `/settings` (#95, #15).
 *
 * Two groups of fields that look alike and are not:
 *
 *   - Settlement: which stablecoin the merchant is paid in (by default, and
 *     per network), what a payer may pay with, and the address the money is
 *     sent to. Changing the address
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
import { NetworkSettings, settlementOptionsOf } from "@/components/settings-networks";
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
import { Label } from "@/components/ui/label";
import { PageLoader } from "@/components/ui/page-loader";
import { QueryError } from "@/components/ui/query-error";
import {
  Select,
  SelectContent,
  SelectItem,
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

/** Every country, alphabetical. */
const COUNTRY_OPTIONS: readonly ComboboxOption[] = COUNTRIES.map((country) => ({
  value: country.code,
  label: country.label,
}));

interface Draft {
  readonly settlementAsset: string;
  /** Settlement asset overridden per chain. A chain absent settles in `settlementAsset`. */
  readonly settlementAssetByChain: Readonly<Record<string, string>>;
  readonly acceptedAssets: readonly string[];
  /**
   * Accepted assets narrowed per chain (#244).
   *
   * A chain absent inherits `acceptedAssets`, which is where every merchant
   * starts and where a merchant who never touches the matrix stays.
   */
  readonly acceptedAssetsByChain: Readonly<Record<string, readonly string[]>>;
  readonly settlementAddress: string;
  /** Buyer protection (#304): off, or a hold in whole days and an optional arbiter. */
  readonly protectionOn: boolean;
  readonly protectionDays: string;
  readonly protectionArbiter: string;
  readonly city: string;
  readonly countryCode: string;
}

const SETTINGS_TABS = ["settlement", "profile", "history"] as const;
const HISTORY_PAGE_SIZE = 10;
type SettingsTab = (typeof SETTINGS_TABS)[number];

function draftOf(settings: SettingsDto): Draft {
  return {
    settlementAsset: settings.settlementAsset,
    settlementAssetByChain: settings.settlementAssetByChain,
    acceptedAssets: settings.acceptedAssets,
    acceptedAssetsByChain: settings.acceptedAssetsByChain,
    settlementAddress: settings.settlementAddress ?? "",
    protectionOn: settings.buyerProtection !== null,
    protectionDays: String(Math.round((settings.buyerProtection?.holdSeconds ?? 7 * DAY) / DAY)),
    protectionArbiter: settings.buyerProtection?.arbiter ?? "",
    city: settings.city ?? "",
    countryCode: settings.countryCode ?? "",
  };
}

const DAY = 86_400;

/** Whole days between 1 and 90 — the bounds the API enforces. */
function isValidHoldDays(value: string): boolean {
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= 90;
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
  const settlementOptions = settlementOptionsOf(supportedChains, draft?.settlementAsset);
  // Blocks the save rather than only colouring the field: the API probes every
  // chain for contract code before it validates, so a malformed address came
  // back as a provider fault instead of as the typo it is.
  const addressInvalid = draft !== null && !isValidSettlementAddress(draft.settlementAddress);
  const holdInvalid = draft?.protectionOn === true && !isValidHoldDays(draft.protectionDays);
  const arbiterInvalid =
    draft?.protectionOn === true && !isValidSettlementAddress(draft.protectionArbiter);
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
        settlementAssetByChain: draft.settlementAssetByChain,
        acceptedAssets: draft.acceptedAssets,
        acceptedAssetsByChain: draft.acceptedAssetsByChain,
        settlementAddress: orNull(draft.settlementAddress),
        buyerProtection: draft.protectionOn
          ? {
              holdSeconds: Number(draft.protectionDays) * DAY,
              ...(orNull(draft.protectionArbiter) === null
                ? {}
                : { arbiter: draft.protectionArbiter.trim() }),
            }
          : null,
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
                {/* Save sits on the tab row, not under the form: the settlement
                    form runs past the fold, and a button below it was the one
                    control a merchant had to scroll to find. */}
                {/* On a phone the tabs take the full row and Save drops under
                    them: side by side, the button covered the last tab. */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:border-border sm:border-b">
                  <Tabs.List
                    aria-label="Settings sections"
                    className="flex min-w-0 flex-1 overflow-x-auto border-border border-b sm:border-b-0"
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
                        className="min-h-11 shrink-0 cursor-pointer border-transparent border-b-2 px-3 font-sans sm:px-4 text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-active:border-brand data-active:text-foreground dark:data-active:border-electric"
                      >
                        {label}
                      </Tabs.Tab>
                    ))}
                  </Tabs.List>
                  {activeTab !== "history" && (
                    <Button
                      size="default"
                      className="w-full sm:w-auto"
                      onClick={save}
                      disabled={
                        update.isPending ||
                        addressInvalid ||
                        holdInvalid ||
                        arbiterInvalid ||
                        JSON.stringify(draft) === JSON.stringify(draftOf(loaded))
                      }
                    >
                      {update.isPending ? "Saving…" : "Save settings"}
                    </Button>
                  )}
                </div>

                <Tabs.Panel value="settlement" className="pt-6 focus-visible:outline-none">
                  <Card className="flex flex-col gap-4 p-4">
                    <Field>
                      <FieldLabel htmlFor="settlement-asset">Default settlement asset</FieldLabel>
                      <Select
                        items={settlementOptions}
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
                          {settlementOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              <AssetLabel symbol={option.value} size={18} />
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        What you are paid in on every network without its own choice below. Whatever
                        a payer sends is converted to it before it reaches you.
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
                        <FieldLabel>Networks</FieldLabel>
                        <NetworkSettings
                          supported={supportedChains}
                          draft={draft}
                          onChange={(next) => edit({ ...draft, ...next })}
                        />
                        <FieldDescription>
                          Each network settles in your default asset unless you choose otherwise.
                          Open a network to pick what payers can send there and what you are paid
                          in.
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

                  <Card className="mt-6 flex flex-col gap-4 p-4">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="buyer-protection"
                        checked={draft.protectionOn}
                        onCheckedChange={(checked) =>
                          edit({ ...draft, protectionOn: checked === true })
                        }
                      />
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="buyer-protection" className="cursor-pointer">
                          Buyer protection
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          Hold the buyer's payment until they confirm delivery. It's released to you
                          automatically when the hold ends.
                        </p>
                      </div>
                    </div>

                    {draft.protectionOn && (
                      <div className="grid gap-4 md:grid-cols-[10rem_1fr]">
                        <Field>
                          <FieldLabel htmlFor="protection-days">Hold (days)</FieldLabel>
                          <Input
                            id="protection-days"
                            inputMode="numeric"
                            value={draft.protectionDays}
                            onChange={(e) => edit({ ...draft, protectionDays: e.target.value })}
                            aria-invalid={holdInvalid}
                          />
                          {holdInvalid && <FieldError>Between 1 and 90 days.</FieldError>}
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="protection-arbiter">Arbiter</FieldLabel>
                          <Input
                            id="protection-arbiter"
                            value={draft.protectionArbiter}
                            onChange={(e) => edit({ ...draft, protectionArbiter: e.target.value })}
                            placeholder="Mayarin Resolution"
                            aria-invalid={arbiterInvalid}
                            className="font-mono text-xs"
                          />
                          <FieldDescription>
                            Decides disputes. Blank uses Mayarin Resolution.
                          </FieldDescription>
                          {arbiterInvalid && (
                            <FieldError>Enter a 20-byte hex address, or leave it blank.</FieldError>
                          )}
                        </Field>
                      </div>
                    )}
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
                      Both fields are frozen into every payment a link takes, and a payment link
                      cannot be created without them.
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
            </>
          );
        })}
    </section>
  );
}

export default withQuery(Settings);

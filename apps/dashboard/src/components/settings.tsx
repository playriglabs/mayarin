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
 *   - General: city and country, frozen into the snapshot every payment link
 *     and payment carries, so a buyer sees them; and buyer protection, a
 *     switch whose terms (hold, dispute bond, arbiter) are set in a dialog.
 *
 * `effectiveSettlementAddress` is where the money actually goes — what the
 * merchant chose, or their managed wallet when they chose nothing. It is shown
 * separately from the chosen address because "blank" is not "nowhere", and a
 * merchant should be able to read the answer rather than infer it.
 */

import { Tabs } from "@base-ui-components/react/tabs";
import { chainLabel, isSolanaChainId } from "@mayarin/chain";
import { BankIcon, MapPinIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { match } from "ts-pattern";
import { AssetLabel } from "@/components/asset-logo";
import { ChainLabel } from "@/components/chain-logo";
import { InfoHint } from "@/components/info-hint";
import { MerchantProfile } from "@/components/merchant-profile";
import { PasswordSection, SecuritySection } from "@/components/security";
import { NetworkSettings, settlementOptionsOf } from "@/components/settings-networks";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  type ComboboxOption,
} from "@/components/ui/combobox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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

/** The country's flag emoji, from its two regional-indicator letters. */
function flagOf(code: string): string {
  return String.fromCodePoint(...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

/** Every country, alphabetical, shown as its flag and name. */
const COUNTRY_OPTIONS: readonly ComboboxOption[] = COUNTRIES.map((country) => ({
  value: country.code,
  label: `${flagOf(country.code)}  ${country.name}`,
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
  /** The dispute bond as a percent of the payment (#315), "0" for none. */
  readonly protectionBond: string;
  readonly city: string;
  readonly countryCode: string;
  /** The chain a local-currency payment is delivered to; `""` is the deployment's rule. */
  readonly localCurrencyChain: string;
}

const SETTINGS_TABS = ["settlement", "general", "history"] as const;
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
    protectionBond: String((settings.buyerProtection?.bondBps ?? 0) / 100),
    city: settings.city ?? "",
    countryCode: settings.countryCode ?? "",
    localCurrencyChain: settings.localCurrencyChain ?? "",
  };
}

const DAY = 86_400;

/** The select's stand-in for "no chain chosen": the deployment's rule applies. */
const AUTOMATIC = "automatic";

/** Whole days between 1 and 90 — the bounds the API enforces. */
function isValidHoldDays(value: string): boolean {
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= 90;
}

/** 0–20%, at most two decimals — whole basis points, as the API takes. */
function isValidBondPercent(value: string): boolean {
  return /^\d{1,2}(\.\d{1,2})?$/.test(value.trim()) && Number(value) <= 20;
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

type ProtectionTerms = Pick<Draft, "protectionDays" | "protectionBond" | "protectionArbiter">;

/**
 * The terms buyer protection runs on, asked for when it is switched on (and
 * from "Edit terms" after). Edits here stay here until confirmed: cancelling
 * leaves the switch where it was and the draft untouched. Confirming only
 * changes the draft — "Save settings" is still what stores it.
 */
function ProtectionDialog({
  open,
  initial,
  onCancel,
  onConfirm,
  confirmLabel,
}: {
  readonly open: boolean;
  readonly initial: ProtectionTerms;
  readonly onCancel: () => void;
  readonly onConfirm: (terms: ProtectionTerms) => void;
  /** "Turn on" when switching it on, "Apply" when editing terms already on. */
  readonly confirmLabel: string;
}) {
  const [terms, setTerms] = useState<ProtectionTerms>(initial);
  // Each opening starts from the draft, not from whatever was typed and cancelled last time.
  useEffect(() => {
    if (open) {
      setTerms({
        protectionDays: initial.protectionDays,
        protectionBond: initial.protectionBond,
        protectionArbiter: initial.protectionArbiter,
      });
    }
  }, [open, initial.protectionDays, initial.protectionBond, initial.protectionArbiter]);

  const holdInvalid = !isValidHoldDays(terms.protectionDays);
  const bondInvalid = !isValidBondPercent(terms.protectionBond);
  const arbiterInvalid = !isValidSettlementAddress(terms.protectionArbiter);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Buyer protection</DialogTitle>
          <DialogDescription>
            The buyer's payment is held in escrow for the hold period, then released to you unless
            they dispute it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="protection-days">Hold (days)</FieldLabel>
              <Input
                id="protection-days"
                inputMode="numeric"
                value={terms.protectionDays}
                onChange={(e) => setTerms({ ...terms, protectionDays: e.target.value })}
                aria-invalid={holdInvalid}
              />
              {holdInvalid && <FieldError>Between 1 and 90 days.</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="protection-bond">Dispute bond (%)</FieldLabel>
              <Input
                id="protection-bond"
                inputMode="decimal"
                value={terms.protectionBond}
                onChange={(e) => setTerms({ ...terms, protectionBond: e.target.value })}
                aria-invalid={bondInvalid}
              />
              {bondInvalid && <FieldError>Between 0 and 20.</FieldError>}
            </Field>
          </div>
          <FieldDescription>
            The buyer posts the bond to dispute and loses it if the claim fails.
          </FieldDescription>
          <Field>
            <FieldLabel htmlFor="protection-arbiter">Arbiter</FieldLabel>
            <Input
              id="protection-arbiter"
              value={terms.protectionArbiter}
              onChange={(e) => setTerms({ ...terms, protectionArbiter: e.target.value })}
              placeholder="Mayarin Resolution"
              aria-invalid={arbiterInvalid}
              className="font-mono text-xs"
            />
            <FieldDescription>Decides disputes. Blank uses Mayarin Resolution.</FieldDescription>
            {arbiterInvalid && (
              <FieldError>Enter a 20-byte hex address, or leave it blank.</FieldError>
            )}
          </Field>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Cancel</Button>} />
          <Button
            onClick={() => onConfirm(terms)}
            disabled={holdInvalid || bondInvalid || arbiterInvalid}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The settlement address, edited in a dialog so the settlement tab reads as
 * where the money goes rather than as a form. Same contract as the protection
 * dialog: cancelling leaves the draft untouched, applying only changes the
 * draft — "Save settings" is still what stores it.
 */
function AddressDialog({
  open,
  initial,
  onCancel,
  onConfirm,
}: {
  readonly open: boolean;
  readonly initial: string;
  readonly onCancel: () => void;
  readonly onConfirm: (address: string) => void;
}) {
  const [address, setAddress] = useState(initial);
  // Each opening starts from the draft, not from whatever was typed and cancelled last time.
  useEffect(() => {
    if (open) setAddress(initial);
  }, [open, initial]);

  const invalid = !isValidSettlementAddress(address);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settlement address</DialogTitle>
          <DialogDescription>
            Leave it blank to be paid at your managed wallet. There is no shared default: one
            address for every merchant would pay every merchant into the same wallet.
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="settlement-address">EVM address</FieldLabel>
          <Input
            id="settlement-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x…"
            aria-invalid={invalid}
            className="font-mono text-xs"
          />
          {invalid && (
            <FieldError>
              Enter a 20-byte hex address, e.g. 0x1234…abcd, or leave it blank.
            </FieldError>
          )}
        </Field>

        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Cancel</Button>} />
          <Button onClick={() => onConfirm(address.trim())} disabled={invalid}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Settings() {
  const settings = useSettings();
  const history = useSettingsHistory();
  const rails = useMerchantRails();
  const update = useUpdateSettings();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [protectionDialog, setProtectionDialog] = useState(false);
  const [addressDialog, setAddressDialog] = useState(false);
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
  // Solana is paid at a verified wallet, not at the EVM address above, so its
  // destination is read from the rails that already resolved it per chain.
  const offersSolana = supportedChains.some((entry) => isSolanaChainId(entry.chain));
  const solanaAddresses = [
    ...new Set(
      (rails.data?.rails ?? [])
        .filter((rail) => isSolanaChainId(rail.chain) && rail.payTo !== null)
        .map((rail) => rail.payTo),
    ),
  ];
  const settlementOptions = settlementOptionsOf(supportedChains, draft?.settlementAsset);
  // The merchant's own networks, plus the rule. A chain the provider cannot
  // deliver to is listed but greyed out and says so, rather than being offered as
  // if it would work; the server also falls back past it, should one be saved.
  const providerChains = rails.data?.localCurrencyChains ?? null;
  const unsupportedForLocal = (chain: string) =>
    providerChains !== null && !providerChains.includes(chain);
  const localCurrencyOptions: readonly SelectOption[] = [
    { value: AUTOMATIC, label: "Automatic" },
    ...supportedChains.map((entry) => ({ value: entry.chain, label: chainLabel(entry.chain) })),
  ];
  // Blocks the save rather than only colouring the field: the API probes every
  // chain for contract code before it validates, so a malformed address came
  // back as a provider fault instead of as the typo it is.
  const addressInvalid = draft !== null && !isValidSettlementAddress(draft.settlementAddress);
  const holdInvalid = draft?.protectionOn === true && !isValidHoldDays(draft.protectionDays);
  const bondInvalid = draft?.protectionOn === true && !isValidBondPercent(draft.protectionBond);
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
              bondBps: Math.round(Number(draft.protectionBond) * 100),
            }
          : null,
        city: orNull(draft.city),
        countryCode: orNull(draft.countryCode),
        localCurrencyChain: orNull(draft.localCurrencyChain),
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
                        ["general", "General"],
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
                        bondInvalid ||
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
                    {/* Two answers to "where does my money land", side by side. */}
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:[&>*]:min-w-0 sm:[&>*]:flex-1">
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
                              renderValue={(option) => (
                                <AssetLabel symbol={option.value} size={18} />
                              )}
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
                          What you are paid in on every network without its own choice below.
                          Whatever a payer sends is converted to it before it reaches you.
                        </FieldDescription>
                      </Field>
                      {!rails.isPending &&
                        !rails.isError &&
                        supportedChains.length > 0 &&
                        providerChains !== null && (
                          <Field>
                            <div className="flex items-center gap-1.5">
                              <FieldLabel htmlFor="local-currency-chain">
                                Local fiat currency payments are delivered to
                              </FieldLabel>
                              <InfoHint text="Automatic picks the network that needs no conversion into your settlement asset, then the cheapest one the provider supports. A network the provider cannot deliver to falls back to Automatic." />
                            </div>
                            <Select
                              items={localCurrencyOptions}
                              value={
                                draft.localCurrencyChain === ""
                                  ? AUTOMATIC
                                  : draft.localCurrencyChain
                              }
                              onValueChange={(next) =>
                                edit({
                                  ...draft,
                                  localCurrencyChain: next === AUTOMATIC ? "" : next,
                                })
                              }
                            >
                              <SelectTrigger id="local-currency-chain">
                                <SelectValue
                                  placeholder="Automatic"
                                  renderValue={(option) =>
                                    option.value === AUTOMATIC ? (
                                      <span>Automatic</span>
                                    ) : (
                                      <span className="inline-flex items-center gap-2">
                                        <ChainLabel chain={option.value} size={18} />
                                        {unsupportedForLocal(option.value) && (
                                          <span className="text-xs text-warning">
                                            Not supported right now
                                          </span>
                                        )}
                                      </span>
                                    )
                                  }
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {localCurrencyOptions.map((option) => (
                                  <SelectItem
                                    key={option.value}
                                    value={option.value}
                                    disabled={
                                      option.value !== AUTOMATIC &&
                                      unsupportedForLocal(option.value)
                                    }
                                  >
                                    {option.value === AUTOMATIC ? (
                                      <span>Automatic</span>
                                    ) : (
                                      <span className="inline-flex items-center gap-2">
                                        <ChainLabel chain={option.value} size={18} />
                                        {unsupportedForLocal(option.value) && (
                                          <span className="text-xs">Not supported right now</span>
                                        )}
                                      </span>
                                    )}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FieldDescription>
                              The network GCash, QRIS and bank-transfer payments land on.
                            </FieldDescription>
                          </Field>
                        )}
                    </div>

                    {/* Per network and nowhere else. One merchant-wide list
                        stopped describing anything the moment there were two
                        chains — Base can receive ETH and Arc cannot — so a
                        merchant ticking ETH was never saying they accept it
                        everywhere (#244). Showing both a global list and a
                        per-network one asked them to answer the same question
                        twice, so only the network cards remain. */}
                    {rails.isPending && (
                      <Field>
                        <FieldLabel>Networks</FieldLabel>
                        {/* The shape of the network list, so nothing jumps when it lands. */}
                        <ul
                          role="status"
                          aria-label="Loading networks"
                          className="flex flex-col divide-y divide-border rounded-lg border border-border"
                        >
                          {["first", "second", "third", "fourth", "fifth"].map((row) => (
                            <li key={row} className="flex items-center gap-3 p-3">
                              <Skeleton className="size-5 rounded-full" />
                              <Skeleton className="h-4 w-36" />
                              <Skeleton className="ml-auto h-4 w-44" />
                            </li>
                          ))}
                        </ul>
                      </Field>
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

                    {/* Shown in full and never truncated in the DOM: an address a
                      merchant cannot copy whole is worse than one they scroll. */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-sm">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <BankIcon
                          size={ICON_CARD}
                          aria-hidden="true"
                          className="text-muted-foreground"
                        />
                        <span className="text-muted-foreground">EVM paid to</span>
                        <span className="break-all font-mono text-xs">
                          {loaded.effectiveSettlementAddress ?? "nowhere yet"}
                        </span>
                        <Badge variant={loaded.canSettleOnChain ? "success" : "warning"}>
                          {loaded.canSettleOnChain ? "Can settle on chain" : "No address"}
                        </Badge>
                      </div>
                      <Button size="sm" variant="secondary" onClick={() => setAddressDialog(true)}>
                        Change address
                      </Button>
                    </div>
                    {offersSolana && !rails.isPending && (
                      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <BankIcon
                            size={ICON_CARD}
                            aria-hidden="true"
                            className="text-muted-foreground"
                          />
                          <span className="text-muted-foreground">Solana paid to</span>
                          <span className="break-all font-mono text-xs">
                            {solanaAddresses.length === 0
                              ? "nowhere yet"
                              : solanaAddresses.join(", ")}
                          </span>
                          <Badge variant={solanaAddresses.length > 0 ? "success" : "warning"}>
                            {solanaAddresses.length > 0 ? "Can settle on chain" : "No address"}
                          </Badge>
                        </div>
                        <a
                          href="/wallets"
                          className={buttonVariants({ variant: "secondary", size: "sm" })}
                        >
                          {solanaAddresses.length > 0 ? "Manage" : "Set up"}
                        </a>
                      </div>
                    )}
                    {/* An applied but unsaved change would otherwise be
                        invisible: "Paid to" shows what is stored. */}
                    {draft.settlementAddress.trim() !== (loaded.settlementAddress ?? "") && (
                      <p className="text-sm text-warning">
                        After you save, paid to{" "}
                        {draft.settlementAddress.trim() === "" ? (
                          "your managed wallet"
                        ) : (
                          <span className="break-all font-mono text-xs">
                            {draft.settlementAddress.trim()}
                          </span>
                        )}
                        .
                      </p>
                    )}

                    <AddressDialog
                      open={addressDialog}
                      initial={draft.settlementAddress}
                      onCancel={() => setAddressDialog(false)}
                      onConfirm={(address) => {
                        edit({ ...draft, settlementAddress: address });
                        setAddressDialog(false);
                      }}
                    />
                  </Card>
                </Tabs.Panel>

                <Tabs.Panel
                  value="general"
                  className="flex flex-col gap-6 pt-6 focus-visible:outline-none"
                >
                  <MerchantProfile settings={loaded} />

                  <SecuritySection />
                  <PasswordSection />

                  <Card className="flex flex-col gap-5 p-5">
                    <div className="flex flex-col gap-1">
                      <h3 className="font-medium text-foreground text-sm">Business location</h3>
                      <p className="text-muted-foreground text-sm">
                        Shown to buyers on every payment. A payment link needs both.
                      </p>
                    </div>
                    {/* One row: a city and a country are one fact — where the
                        merchant is — not two settings a reader hunts for. */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <FieldLabel htmlFor="merchant-city">City</FieldLabel>
                        <InputGroup>
                          <InputGroupAddon>
                            <MapPinIcon size={16} />
                          </InputGroupAddon>
                          <InputGroupInput
                            id="merchant-city"
                            value={draft.city}
                            onChange={(e) => edit({ ...draft, city: e.target.value })}
                            placeholder="Jakarta"
                          />
                        </InputGroup>
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
                  </Card>

                  <Card className="flex flex-col gap-4 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="buyer-protection" className="cursor-pointer">
                          Buyer protection
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          Hold the buyer's payment until they confirm delivery. It's released to you
                          automatically when the hold ends.
                        </p>
                      </div>
                      <Switch
                        id="buyer-protection"
                        checked={draft.protectionOn}
                        onCheckedChange={(checked) =>
                          checked
                            ? setProtectionDialog(true)
                            : edit({ ...draft, protectionOn: false })
                        }
                      />
                    </div>

                    {draft.protectionOn && (
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-sm">
                        <dl className="flex flex-wrap gap-x-6 gap-y-1">
                          <div className="flex gap-1.5">
                            <dt className="text-muted-foreground">Hold</dt>
                            <dd>
                              {draft.protectionDays} {draft.protectionDays === "1" ? "day" : "days"}
                            </dd>
                          </div>
                          <div className="flex gap-1.5">
                            <dt className="text-muted-foreground">Dispute bond</dt>
                            <dd>{draft.protectionBond}%</dd>
                          </div>
                          <div className="flex min-w-0 gap-1.5">
                            <dt className="text-muted-foreground">Arbiter</dt>
                            <dd className="break-all font-mono text-xs leading-5">
                              {draft.protectionArbiter.trim() === ""
                                ? "Mayarin Resolution"
                                : draft.protectionArbiter.trim()}
                            </dd>
                          </div>
                        </dl>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setProtectionDialog(true)}
                        >
                          Edit terms
                        </Button>
                      </div>
                    )}
                  </Card>

                  <ProtectionDialog
                    open={protectionDialog}
                    initial={draft}
                    confirmLabel={draft.protectionOn ? "Apply" : "Turn on"}
                    onCancel={() => setProtectionDialog(false)}
                    onConfirm={(terms) => {
                      edit({ ...draft, ...terms, protectionOn: true });
                      setProtectionDialog(false);
                    }}
                  />
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

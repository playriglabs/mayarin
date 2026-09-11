/**
 * Payment links — a React island over `/payment-links` (#15).
 *
 * This is the surface that makes a merchant able to take a payment without
 * anyone running a script. A link is a template, not a payment: the buyer
 * opening it mints a fresh Payment Intent with its own price lock and expiry,
 * which is what lets one printed QR on a counter serve every sale of the day.
 *
 * Three kinds, and the difference matters at the counter:
 *   - fixed   — one amount, decided now. A specific invoice.
 *   - open    — the buyer enters the amount. This is what a counter QR is.
 *   - catalog — priced from the merchant's own products at checkout time.
 *
 * There are two codes here and they are not interchangeable:
 *
 *   - **Take payment** starts one sale and shows its EIP-681 deposit code. A
 *     wallet scanning that opens a transfer — an address, a chain and an exact
 *     amount, already filled in. This is the counter flow.
 *   - **Share** shows the link's own URL, which opens the hosted checkout page
 *     in a browser. This is what you send to someone; scanning it with a wallet
 *     does nothing useful, which is why it is not the primary action.
 *
 * A deposit address belongs to one payment, not to the link: it is allocated at
 * price lock and every sale gets its own, which is what lets the watcher tell
 * one payer's transfer from another's. So the link cannot carry one, and the
 * counter flow mints a payment first.
 */

import { chainLabel } from "@mayarin/chain";
import {
  CheckIcon,
  CopyIcon,
  DownloadSimpleIcon,
  LinkIcon,
  PackageIcon,
  PencilSimpleIcon,
  PlusIcon,
  QrCodeIcon,
  ReceiptIcon,
  ShareNetworkIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { match } from "ts-pattern";
import { AssetLogo } from "@/components/asset-logo";
import { ChainLogo } from "@/components/chain-logo";
import { DepositQr } from "@/components/deposit-qr";
import { RailGroups } from "@/components/rail-groups";
import { Alert } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CurrencyInput } from "@/components/ui/currency-input";
import { CursorPagination } from "@/components/ui/cursor-pagination";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyAction,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import { TableSkeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useChargeLink,
  useCreateLink,
  useDisableLink,
  usePaymentLinks,
  useProductOptions,
  useQuoteLink,
  useUpdateLink,
} from "@/hooks/catalog";
import { useCursorPagination } from "@/hooks/cursor-pagination";
import { useMerchantRails, useSettings } from "@/hooks/settings";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD, ICON_NAV } from "@/lib/icons";
import { PAGE_SIZE } from "@/lib/pagination";
import { currencyLabel, isValidAmount, PRICING_CURRENCIES } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { withQuery } from "@/lib/with-query";
import type {
  PaymentLinkDto,
  PaymentLinkKind,
  PaymentLinkRail,
  QuoteLine,
  QuoteResponse,
} from "@/types/catalog";
import type { MerchantRailDto } from "@/types/settings";

const KIND_OPTIONS: readonly SelectOption[] = [
  { value: "fixed", label: "Fixed amount" },
  { value: "open", label: "Open amount (counter QR)" },
  { value: "catalog", label: "From catalog" },
];

const KIND_LABEL: Readonly<Record<PaymentLinkKind, string>> = {
  fixed: "Fixed",
  open: "Open",
  catalog: "Catalog",
};

const CURRENCY_OPTIONS: readonly SelectOption[] = PRICING_CURRENCIES.map((code) => ({
  value: code,
  label: currencyLabel(code),
}));

function LinkCurrencyField({
  value,
  options = CURRENCY_OPTIONS,
  locked = false,
  description,
  onValueChange,
}: {
  readonly value: string;
  readonly options?: readonly SelectOption[];
  readonly locked?: boolean;
  readonly description?: string;
  readonly onValueChange?: (currency: string) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor="link-currency">Currency</FieldLabel>
      <Select
        items={options}
        value={value}
        disabled={locked}
        {...(onValueChange === undefined ? {} : { onValueChange })}
      >
        <SelectTrigger id="link-currency">
          <SelectValue
            placeholder={locked && value === "" ? "Select a product first" : "Select a currency"}
          />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {description !== undefined && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}

interface Draft {
  readonly kind: PaymentLinkKind;
  readonly title: string;
  readonly amount: string;
  readonly currency: string;
  readonly productId: string;
  readonly quantity: string;
  readonly merchantReference: string;
}

const EMPTY_DRAFT: Draft = {
  kind: "fixed",
  title: "",
  amount: "",
  currency: PRICING_CURRENCIES[0] ?? "IDR",
  productId: "",
  quantity: "1",
  merchantReference: "",
};

/** The QR endpoint lives beside the link, on the payment API that serves it. */
function qrSrc(link: PaymentLinkDto, download = false): string {
  const origin = new URL(link.url).origin;
  const query = new URLSearchParams({ value: link.url, brand: "mayarin" });
  if (download) {
    query.set("download", "true");
    query.set("format", "png");
  }
  return `${origin}/checkout/qr?${query.toString()}`;
}

function amountLabel(link: PaymentLinkDto): string {
  if (link.amount !== null) return link.amount.display;
  if (link.kind === "open") return `Buyer enters (${link.currency ?? "—"})`;
  return `Catalog (${link.currency ?? "—"})`;
}

interface CatalogPricedProduct {
  readonly id: string;
  readonly prices: readonly { readonly asset: string }[];
}

/** Catalog order defines the primary price a product link is denominated in. */
export function primaryCatalogCurrency(
  products: readonly CatalogPricedProduct[],
  productId: string,
): string | undefined {
  return catalogCurrencies(products, productId)[0];
}

/** Every explicit currency the selected product can price a catalog link in. */
export function catalogCurrencies(
  products: readonly CatalogPricedProduct[],
  productId: string,
): readonly string[] {
  return (
    products.find((product) => product.id === productId)?.prices.map((price) => price.asset) ?? []
  );
}

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load payment links";
}

function RailMark({ asset, chain }: { readonly asset: string; readonly chain: string }) {
  return (
    <span className="relative size-6 shrink-0" aria-hidden="true">
      <AssetLogo symbol={asset} size={20} className="absolute top-0 left-0 size-5" />
      <ChainLogo
        chain={chain}
        size={10}
        className="absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-card"
      />
    </span>
  );
}

/** A pair is the identity: one network can offer several payer assets. */
const railKey = (rail: { readonly chain: string; readonly asset: string }) =>
  `${rail.chain}:${rail.asset}`;

/** The merchant's live offer narrowed by an immutable link restriction (#259). */
export function paymentRailsForLink(
  rails: readonly MerchantRailDto[],
  allowed: readonly PaymentLinkRail[] | null,
): readonly MerchantRailDto[] {
  if (allowed === null) return rails;
  const selected = new Set(allowed.map(railKey));
  return rails.filter((rail) => selected.has(railKey(rail)));
}

/** What the merchant configured on the link, or today's live set for an unrestricted link. */
export function displayedRailsForLink(
  rails: readonly MerchantRailDto[],
  allowed: readonly PaymentLinkRail[] | null,
): readonly PaymentLinkRail[] {
  const configured = allowed ?? rails;
  return [
    ...new Map(
      configured.map((rail) => [railKey(rail), { chain: rail.chain, asset: rail.asset }]),
    ).values(),
  ];
}

/** A dense table cell: two chips are enough to identify the set, then a count. */
export function railChipSummary(rails: readonly PaymentLinkRail[], limit = 2) {
  return {
    shown: rails.slice(0, limit),
    remaining: Math.max(0, rails.length - limit),
  } as const;
}

function AcceptedRailChips({ rails }: { readonly rails: readonly PaymentLinkRail[] }) {
  if (rails.length === 0) {
    return <span className="text-muted-foreground text-sm">No rails available</span>;
  }

  const { shown, remaining } = railChipSummary(rails);
  const hidden = rails.slice(shown.length);
  const hiddenLabels = hidden.map((rail) => `${chainLabel(rail.chain)} · ${rail.asset}`);

  return (
    <div className="flex flex-nowrap items-center gap-1.5 whitespace-nowrap">
      {shown.map((rail) => (
        <span
          key={railKey(rail)}
          className="inline-flex h-7 items-center gap-1.5 bg-muted px-2 text-muted-foreground text-xs"
        >
          <ChainLogo chain={rail.chain} size={14} className="size-3.5 rounded-full" />
          <span>
            {chainLabel(rail.chain)} · {rail.asset}
          </span>
        </span>
      ))}
      {remaining > 0 && (
        // A real tooltip rather than `title`: it opens on hover and focus, fast,
        // and the screen-reader text still carries the list without hovering.
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex h-7 cursor-default items-center bg-muted px-2 text-muted-foreground text-xs">
                  <span aria-hidden="true">+{remaining}</span>
                  <span className="sr-only">
                    {remaining} more accepted rails: {hiddenLabels.join(", ")}
                  </span>
                </span>
              }
            />
            <TooltipContent className="max-w-md">
              <RailGroups rails={hidden} />
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

function RailSelector({
  idPrefix,
  rails,
  selectedKeys,
  disabled,
  onToggle,
}: {
  readonly idPrefix: string;
  readonly rails: readonly MerchantRailDto[];
  readonly selectedKeys: readonly string[];
  readonly disabled: boolean;
  readonly onToggle: (key: string) => void;
}) {
  return (
    <FieldSet>
      <FieldLegend className="mb-1">Accepted payment rails</FieldLegend>
      <FieldDescription className="mb-3">
        Choose where buyers may pay this link. Changes apply to new checkouts only.
      </FieldDescription>
      {rails.length === 0 ? (
        <Alert role="status">
          No payment rail is available yet. Configure a verified destination in{" "}
          <a href="/wallets" className="underline">
            wallets
          </a>
          .
        </Alert>
      ) : (
        <div className="flex max-h-56 flex-col gap-2 overflow-y-auto pr-1">
          {rails.map((rail) => {
            const key = railKey(rail);
            const inputId = `${idPrefix}-${key.replace(":", "-")}`;
            const picked = selectedKeys.includes(key);
            return (
              <Label
                key={key}
                htmlFor={inputId}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-3 border p-3 transition-colors",
                  picked
                    ? "border-brand bg-brand-muted dark:border-subtle-foreground dark:bg-primary/5"
                    : "border-border bg-card hover:border-subtle-foreground hover:bg-muted/50",
                )}
              >
                <Checkbox
                  id={inputId}
                  checked={picked}
                  onCheckedChange={() => onToggle(key)}
                  disabled={disabled}
                />
                <RailMark asset={rail.asset} chain={rail.chain} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium text-foreground text-xs">{rail.asset}</span>
                  <span className="text-subtle-foreground text-xs">{chainLabel(rail.chain)}</span>
                </span>
              </Label>
            );
          })}
        </div>
      )}
      {rails.length > 0 && selectedKeys.length === 0 && (
        <p role="alert" className="mt-2 text-destructive text-xs">
          Select at least one payment rail.
        </p>
      )}
    </FieldSet>
  );
}

function CheckoutLinkCard({
  url,
  copied,
  onCopy,
}: {
  readonly url: string;
  readonly copied: boolean;
  readonly onCopy: () => void;
}) {
  const parsed = new URL(url);
  const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;

  return (
    <div className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-muted text-muted-foreground">
        <LinkIcon size={18} weight="bold" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="text-subtle-foreground text-xs">Checkout link</span>
        <span className="block min-w-0 truncate font-mono text-xs" title={url}>
          <span className="font-medium text-foreground">{parsed.host}</span>
          <span className="text-muted-foreground">{path}</span>
        </span>
      </span>
      <Button variant="secondary" size="sm" onClick={onCopy}>
        {copied ? (
          <CheckIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
        ) : (
          <CopyIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/**
 * The rails a payer can use, and what each would take.
 *
 * One row per rail: the asset, the network it arrives on, and the figure the
 * customer sends. Picking a row is the choice — there is no separate price
 * table, because two lists of the same assets left the counter guessing which
 * number belonged to the rail they had selected.
 *
 * A rail the quote could not price stays visible with the reason rather than
 * disappearing: the merchant accepts it, and "gone" gives them nothing to act
 * on. It is not selectable, since the lock reads the same source the quote did.
 */
function RailChoice({
  rails,
  value,
  onSelect,
  lineFor,
  pending,
}: {
  readonly rails: readonly MerchantRailDto[];
  readonly value: string;
  readonly onSelect: (rail: string) => void;
  readonly lineFor: (chain: string, asset: string) => QuoteLine | undefined;
  readonly pending: boolean;
}) {
  return (
    <Field>
      <FieldLabel id="charge-rail-label">Customer pays with</FieldLabel>
      {/* A radiogroup rather than a listbox: this is one choice among a handful
          of visible options, and arrow keys should move the selection itself. */}
      {/* Native radios in labels: the browser gives arrow-key navigation and
          grouping for free, and a real input is what a screen reader announces
          as one choice among several. The input is visually hidden; the row it
          labels is what gets styled. */}
      <div
        role="radiogroup"
        aria-labelledby="charge-rail-label"
        aria-busy={pending}
        className={cn(
          "divide-y divide-border overflow-hidden rounded-md border border-border transition-opacity",
          // Re-pricing dims the figures rather than replacing them with a
          // spinner: they are still the right order of magnitude, and a number
          // a counter is reading aloud should not blink out from under them.
          pending && "opacity-60",
        )}
      >
        {rails.map((rail) => {
          const key = `${rail.chain}:${rail.asset}`;
          const line = lineFor(rail.chain, rail.asset);
          // Undefined is "not priced yet", which is not the same as refused:
          // an open link has no amount until the counter types one.
          const refused = line !== undefined && (!line.available || line.amount === null);
          const selected = value === key;

          return (
            <label
              key={key}
              className={cn(
                // The asset and its chain badge share one cell. Only the figure
                // gets its own track, right-aligned.
                "grid grid-cols-[1fr_auto_0.875rem] items-center gap-x-3 px-3 py-2 transition-colors",
                "has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-inset",
                refused ? "cursor-not-allowed opacity-55" : "cursor-pointer hover:bg-accent/50",
                selected && !refused && "bg-accent",
              )}
            >
              <input
                type="radio"
                name="charge-rail"
                value={key}
                checked={selected}
                disabled={refused}
                onChange={() => onSelect(key)}
                className="sr-only"
              />

              <span className="flex min-w-0 items-center gap-2">
                <RailMark asset={rail.asset} chain={rail.chain} />
                <span>{rail.asset}</span>
                <span className="sr-only"> on {chainLabel(rail.chain)}</span>
              </span>

              {refused ? (
                // The reason, not "No rate": a missing oracle feed is an
                // operator's fix, and a blank refusal sends them looking at the
                // customer instead.
                <span className="text-right text-subtle-foreground text-xs">
                  {line?.reason ?? "No rate"}
                </span>
              ) : (
                // Tabular figures so the decimal points stack down the column.
                <span className="text-right font-medium text-foreground text-sm tabular-nums">
                  {line?.amount?.display ?? ""}
                </span>
              )}

              {/* The selected row is already tinted; the check is what survives
                  a colourblind reader and a dimmed re-price. It keeps its
                  column when hidden so the amounts do not shift. */}
              <CheckIcon
                aria-hidden="true"
                className={cn("size-3.5", selected ? "text-primary" : "invisible")}
              />
            </label>
          );
        })}
      </div>
      <FieldDescription>
        Converted to your settlement asset on arrival; the address they scan is specific to the
        network. Indicative until you start the payment.
      </FieldDescription>
    </Field>
  );
}

function PaymentLinks() {
  const pagination = useCursorPagination();
  const links = usePaymentLinks(PAGE_SIZE, pagination.cursor);
  const products = useProductOptions();
  const settings = useSettings();
  const rails = useMerchantRails();
  const create = useCreateLink();
  const charge = useChargeLink();
  const quote = useQuoteLink();
  const disable = useDisableLink();
  const update = useUpdateLink();

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  /** The rails the new link exposes, keyed as `chain:asset` (#259). */
  const [selectedRailKeys, setSelectedRailKeys] = useState<readonly string[]>([]);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [sharing, setSharing] = useState<PaymentLinkDto | null>(null);
  /** The sale being taken: the link, and the payment minted from it. */
  const [charging, setCharging] = useState<PaymentLinkDto | null>(null);
  /** The rail the counter is charging on, as `chain:asset` (#244). */
  const [chargeRail, setChargeRail] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");
  const [takenPaymentId, setTakenPaymentId] = useState<string | null>(null);
  /**
   * What each accepted asset would take, per network, for the amount on screen.
   *
   * Keyed by chain because the accepted set and the swap-leg price are both
   * per-chain (#244). Every network the merchant has a rail on is priced at
   * once, so the list can show a figure against every rail and picking one
   * costs nothing — the alternative re-fetched on every selection and blanked
   * the rows the counter was reading from.
   */
  const [quotedByChain, setQuotedByChain] = useState<Record<string, QuoteResponse>>({});
  const [pendingDisable, setPendingDisable] = useState<PaymentLinkDto | null>(null);
  const [editing, setEditing] = useState<PaymentLinkDto | null>(null);
  const [editingRailKeys, setEditingRailKeys] = useState<readonly string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  const rows = links.data?.paymentLinks ?? [];
  const [chargeChain = "", chargeAsset = ""] = chargeRail.split(":");
  /** What one rail would take, once its network has been priced. */
  const lineFor = (chain: string, asset: string) =>
    quotedByChain[chain]?.quotes.find((line) => line.asset === asset);
  /** The priced line for the rail the counter has selected, once one exists. */
  const selectedQuote = lineFor(chargeChain, chargeAsset);
  /** The merchant's own amount, as any priced network renders it. */
  const chargeSource = Object.values(quotedByChain)[0]?.source.display ?? "";
  const activeProducts = (products.data?.products ?? []).filter((p) => p.active);
  const productOptions: readonly SelectOption[] = activeProducts.map((p) => ({
    value: p.id,
    label: `${p.name} (${p.sku})`,
  }));
  const availableCatalogCurrencies = catalogCurrencies(activeProducts, draft.productId);
  const catalogCurrency = availableCatalogCurrencies.includes(draft.currency)
    ? draft.currency
    : availableCatalogCurrencies[0];
  const catalogCurrencyOptions: readonly SelectOption[] = availableCatalogCurrencies.map(
    (currency) => ({ value: currency, label: currencyLabel(currency) }),
  );

  // A link freezes a merchant snapshot, and the snapshot needs the profile. The
  // server refuses without it; saying so here means the merchant reads it
  // before filling in a form rather than after.
  const profileReady = settings.data?.settings.canCreateLinks ?? true;

  /**
   * What the payer may send, and where (#244).
   *
   * The rail catalog rather than the merchant's accepted-asset list: a pair is
   * only chargeable when the network can receive it, the merchant has somewhere
   * to be paid on it and it can be priced — and the counter finding that out at
   * the price lock leaves a FAILED payment behind for every press of the button.
   */
  const payerRails = rails.data?.rails ?? [];
  const chargingRails = charging === null ? [] : paymentRailsForLink(payerRails, charging.rails);
  /** Every network this link permits, in catalog order — what a quote is asked for. */
  const chargingRailChains = [...new Set(chargingRails.map((rail) => rail.chain))];

  const validShape = match(draft.kind)
    .with("fixed", () => isValidAmount(draft.amount, draft.currency))
    .with("open", () => true)
    .with(
      "catalog",
      () => draft.productId !== "" && catalogCurrency !== undefined && Number(draft.quantity) > 0,
    )
    .exhaustive();
  const canCreate = validShape && rails.isSuccess && selectedRailKeys.length > 0;

  function openCreate() {
    setFailure("");
    setSelectedRailKeys(payerRails.map(railKey));
    setCreating(true);
  }

  function toggleCreateRail(key: string) {
    setSelectedRailKeys((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );
    setFailure("");
  }

  function openEdit(link: PaymentLinkDto) {
    setFailure("");
    const liveRails = paymentRailsForLink(payerRails, link.rails);
    setEditingRailKeys(liveRails.map(railKey));
    setEditing(link);
  }

  function toggleEditRail(key: string) {
    setEditingRailKeys((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );
    setFailure("");
  }

  async function submitEdit() {
    if (editing === null || editingRailKeys.length === 0) return;
    try {
      await update.mutateAsync({
        id: editing.id,
        patch: {
          rails: payerRails
            .filter((rail) => editingRailKeys.includes(railKey(rail)))
            .map(({ chain, asset }) => ({ chain, asset })),
        },
      });
      setEditing(null);
      setEditingRailKeys([]);
      setNotice("Payment rails updated.");
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not update payment rails");
    }
  }

  /**
   * Clipboard access is refused on an insecure origin and by a denied
   * permission, and a merchant who gets neither the tick nor a message is
   * looking at a button that appears broken. The fallback points them to the
   * browser address bar, which still exposes the exact URL.
   */
  async function copy(value: string, id: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      setNotice("Link copied.");
      window.setTimeout(() => setCopied(null), 2_000);
    } catch {
      setFailure("Could not reach the clipboard — open checkout and copy its browser URL.");
    }
  }

  async function submit() {
    if (!canCreate) return;
    const title = draft.title.trim();
    const reference = draft.merchantReference.trim();

    const shape = match(draft.kind)
      .with("fixed", () => ({
        kind: "fixed" as const,
        amount: { amount: draft.amount.trim(), asset: draft.currency },
      }))
      .with("open", () => ({ kind: "open" as const, currency: draft.currency }))
      .with("catalog", () => ({
        kind: "catalog" as const,
        currency: catalogCurrency ?? draft.currency,
        lines: [{ productId: draft.productId, quantity: Number(draft.quantity) }],
      }))
      .exhaustive();

    try {
      const { paymentLink } = await create.mutateAsync({
        ...shape,
        ...(title === "" ? {} : { title }),
        ...(reference === "" ? {} : { merchantReference: reference }),
        rails: payerRails
          .filter((rail) => selectedRailKeys.includes(railKey(rail)))
          .map(({ chain, asset }) => ({ chain, asset })),
      });
      setCreating(false);
      setDraft(EMPTY_DRAFT);
      setSelectedRailKeys([]);
      setNotice("Payment link created.");
      // Straight to the share sheet: the merchant made this link in order to
      // put it somewhere, and a row in a table is not that. Taking a payment is
      // a separate action, because it mints a sale.
      setSharing(paymentLink);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not create the link");
    }
  }

  /** Opens the counter sheet for a link, defaulting to the first payable rail. */
  function openCharge(link: PaymentLinkDto) {
    setFailure("");
    setTakenPaymentId(null);
    setChargeAmount("");
    setQuotedByChain({});
    const allowed = paymentRailsForLink(payerRails, link.rails);
    const first = allowed[0];
    setChargeRail(first === undefined ? "" : `${first.chain}:${first.asset}`);
    setCharging(link);
    // A link that carries its own amount can be priced immediately. An open one
    // has nothing to price until the counter types a figure.
    if (link.kind !== "open") {
      void priceIt(link, undefined, [...new Set(allowed.map((rail) => rail.chain))]);
    }
  }

  /**
   * Prices the sale in every accepted asset.
   *
   * A failure here is not a failure of the sale: the merchant can still take
   * the payment in whichever asset they pick, and the amount is locked
   * server-side when it is confirmed. So it clears the table rather than
   * blocking the button.
   */
  async function priceIt(
    link: PaymentLinkDto,
    amount: string | undefined,
    chains: readonly string[],
  ) {
    const money = amount === undefined ? {} : { amount: { amount, asset: link.currency ?? "IDR" } };
    // Concurrently: two networks are two round trips, and asking for them one
    // after the other is the counter waiting twice for one screen.
    const answers = await Promise.all(
      chains.map(async (chain) => {
        try {
          return [chain, await quote.mutateAsync({ linkId: link.id, ...money, chain })] as const;
        } catch {
          // One network failing to price is not the others failing. Its rows
          // simply carry no figure, and the rail stays visible with the reason
          // the catalog gave for it.
          return [chain, undefined] as const;
        }
      }),
    );

    setQuotedByChain(
      Object.fromEntries(
        answers.filter(
          (entry): entry is readonly [string, QuoteResponse] => entry[1] !== undefined,
        ),
      ),
    );
  }

  /**
   * Starts one sale and shows its address.
   *
   * The payment is minted and priced server-side before anything is displayed:
   * a QR for a payment that has not locked a price is a QR for an amount that
   * can still move.
   */
  async function takePayment() {
    if (charging === null || chargeRail === "") return;
    setFailure("");
    const amount = chargeAmount.trim();

    try {
      const { paymentIntentId } = await charge.mutateAsync({
        linkId: charging.id,
        asset: chargeAsset,
        chain: chargeChain,
        // An open link is priced at the counter; the others price themselves,
        // and the payment API refuses an amount it did not ask for.
        ...(charging.kind === "open" && amount !== ""
          ? { amount: { amount, asset: charging.currency ?? "IDR" } }
          : {}),
      });
      setTakenPaymentId(paymentIntentId);
      setNotice("Payment started. Show the code to the customer.");
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not start the payment");
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs text-subtle-foreground">
          {rows.length} link{rows.length === 1 ? "" : "s"}
        </p>
        <Button className="h-9" onClick={openCreate} disabled={!profileReady || !rails.isSuccess}>
          <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
          New link
        </Button>
      </div>

      {!profileReady && (
        <Alert role="status">
          Set your city and country in{" "}
          <a href="/settings" className="underline">
            settings
          </a>{" "}
          before creating a payment link — both are frozen into every payment the link takes.
        </Alert>
      )}

      <p aria-live="polite" className="sr-only">
        {notice}
      </p>

      {match(links)
        .with({ isPending: true }, () => <TableSkeleton bigSize rows={PAGE_SIZE} />)
        .with({ isError: true }, ({ error }) => (
          <QueryError
            message={reasonOf(error)}
            retry={() => void links.refetch()}
            retrying={links.isFetching}
          />
        ))
        .otherwise(() =>
          rows.length === 0 ? (
            <Empty>
              <EmptyMedia>
                <LinkIcon size={ICON_CARD} aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No payment links yet.</EmptyTitle>
              <EmptyDescription>Create a reusable checkout link or counter QR.</EmptyDescription>
              <EmptyAction>
                <Button onClick={openCreate} disabled={!profileReady || !rails.isSuccess}>
                  <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                  Create your first link
                </Button>
              </EmptyAction>
            </Empty>
          ) : (
            <div className="flex flex-col gap-3">
              <Table>
                <TableCaption>Payment links for this merchant</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Accepted rails</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((link) => (
                    <TableRow key={link.id}>
                      <TableCell>{link.title ?? "Untitled"}</TableCell>
                      <TableCell>
                        <Badge>{KIND_LABEL[link.kind]}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{amountLabel(link)}</TableCell>
                      <TableCell>
                        <AcceptedRailChips rails={displayedRailsForLink(payerRails, link.rails)} />
                      </TableCell>
                      <TableCell>
                        <Badge variant={link.payable ? "success" : "default"}>
                          {link.payable ? "Payable" : "Retired"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <time dateTime={isoAttr(link.createdAt)}>
                          {formatDateTime(link.createdAt)}
                        </time>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="flex justify-end gap-1">
                          {/* The counter action, and the primary one: it starts a
                            sale and produces a code a wallet can pay. */}
                          <Button
                            size="sm"
                            onClick={() => openCharge(link)}
                            disabled={!link.payable}
                          >
                            <QrCodeIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                            Take payment
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(link)}
                            disabled={!link.payable || !rails.isSuccess || update.isPending}
                            aria-label={`Edit accepted rails for ${link.title ?? link.id}`}
                            title="Edit accepted rails"
                          >
                            <PencilSimpleIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSharing(link)}
                            disabled={!link.payable}
                            aria-label={`Share the link for ${link.title ?? link.id}`}
                          >
                            <ShareNetworkIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setPendingDisable(link)}
                            disabled={!link.payable}
                            aria-label={`Retire ${link.title ?? link.id}`}
                          >
                            <XIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                          </Button>
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <CursorPagination
                label="Payment link pages"
                page={pagination.page}
                canPrevious={pagination.canPrevious}
                nextCursor={links.data?.nextCursor}
                busy={links.isFetching}
                onPrevious={pagination.previous}
                onNext={pagination.next}
              />
            </div>
          ),
        )}

      <Dialog open={creating} onOpenChange={(next) => !next && setCreating(false)}>
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-xl overflow-y-auto p-5 sm:p-6">
          <DialogHeader>
            <DialogTitle>New payment link</DialogTitle>
            <DialogDescription className="mt-px">
              Every buyer who opens this link gets their own payment, priced when they open it.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {failure !== "" && <Alert variant="destructive">{failure}</Alert>}

            <Field>
              <FieldLabel htmlFor="link-kind">Kind</FieldLabel>
              <Select
                items={KIND_OPTIONS}
                value={draft.kind}
                onValueChange={(next) => setDraft({ ...draft, kind: next as PaymentLinkKind })}
              >
                <SelectTrigger id="link-kind">
                  <SelectValue placeholder="Select a kind" />
                </SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                An open link is what a printed counter QR is: one code, a different amount every
                sale.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="link-title">Title</FieldLabel>
              <Input
                id="link-title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Counter"
              />
            </Field>

            {draft.kind !== "catalog" && (
              <LinkCurrencyField
                value={draft.currency}
                onValueChange={(currency) => setDraft({ ...draft, currency })}
              />
            )}

            {draft.kind === "fixed" && (
              <Field>
                <FieldLabel htmlFor="link-amount">Amount</FieldLabel>
                <CurrencyInput
                  id="link-amount"
                  asset={draft.currency}
                  value={draft.amount}
                  onValueChange={(amount) => setDraft({ ...draft, amount })}
                  placeholder="50.000,00"
                />
              </Field>
            )}

            {draft.kind === "catalog" && (
              <>
                <Field>
                  <FieldLabel htmlFor="link-product">Product</FieldLabel>
                  {products.isPending ? (
                    <PageLoader label="Loading products" className="min-h-24" size={24} />
                  ) : products.isError ? (
                    <QueryError
                      message={
                        products.error instanceof ApiError
                          ? products.error.message
                          : "Failed to load products"
                      }
                      retry={() => void products.refetch()}
                      retrying={products.isFetching}
                    />
                  ) : productOptions.length === 0 ? (
                    <Empty className="gap-1 px-4 py-6">
                      <EmptyMedia>
                        <PackageIcon size={ICON_CARD} aria-hidden="true" />
                      </EmptyMedia>
                      <EmptyTitle>No active products.</EmptyTitle>
                      <EmptyDescription>
                        Add or activate a product before creating a catalog payment link.
                      </EmptyDescription>
                      <EmptyAction className="mt-3">
                        <a href="/catalog" className={buttonVariants({ size: "sm" })}>
                          <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                          Add a product
                        </a>
                      </EmptyAction>
                    </Empty>
                  ) : (
                    <Select
                      items={productOptions}
                      value={draft.productId}
                      onValueChange={(next) =>
                        setDraft({
                          ...draft,
                          productId: next,
                          currency: primaryCatalogCurrency(activeProducts, next) ?? draft.currency,
                        })
                      }
                    >
                      <SelectTrigger id="link-product">
                        <SelectValue placeholder="Select a product" />
                      </SelectTrigger>
                      <SelectContent>
                        {productOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>

                <LinkCurrencyField
                  value={catalogCurrency ?? ""}
                  options={catalogCurrencyOptions}
                  locked={catalogCurrencyOptions.length < 2}
                  description={
                    catalogCurrencyOptions.length < 2
                      ? "Set by the selected product's catalog price."
                      : "Choose which of this product's prices the link will use."
                  }
                  onValueChange={(currency) => setDraft({ ...draft, currency })}
                />

                {productOptions.length > 0 && (
                  <Field>
                    <FieldLabel htmlFor="link-quantity">Quantity</FieldLabel>
                    <Input
                      id="link-quantity"
                      inputMode="numeric"
                      placeholder="1"
                      value={draft.quantity}
                      onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
                    />
                  </Field>
                )}
              </>
            )}

            <RailSelector
              idPrefix="link-rail"
              rails={payerRails}
              selectedKeys={selectedRailKeys}
              disabled={create.isPending}
              onToggle={toggleCreateRail}
            />

            <Field>
              <FieldLabel htmlFor="link-reference">Your reference</FieldLabel>
              <Input
                id="link-reference"
                value={draft.merchantReference}
                onChange={(e) => setDraft({ ...draft, merchantReference: e.target.value })}
                placeholder="order-1042"
                className="font-mono text-xs"
              />
              <FieldDescription>
                Copied onto every payment this link takes, so you can find it in your own system.
              </FieldDescription>
            </Field>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button onClick={submit} disabled={!canCreate || create.isPending}>
              Create link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(next) => !next && setEditing(null)}>
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-xl overflow-y-auto p-5 sm:p-6">
          <DialogHeader>
            <DialogTitle>Edit accepted rails</DialogTitle>
            <DialogDescription className="mt-px">
              {editing?.title ?? "This payment link"} — changes apply to new checkouts only.
            </DialogDescription>
          </DialogHeader>

          {failure !== "" && <Alert variant="destructive">{failure}</Alert>}

          <RailSelector
            idPrefix="edit-link-rail"
            rails={payerRails}
            selectedKeys={editingRailKeys}
            disabled={update.isPending}
            onToggle={toggleEditRail}
          />

          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button
              onClick={() => void submitEdit()}
              disabled={editingRailKeys.length === 0 || update.isPending || payerRails.length === 0}
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The counter sheet: one sale, one address, scanned by the customer. */}
      <Dialog
        open={charging !== null}
        onOpenChange={(next) => {
          if (!next) {
            setCharging(null);
            setTakenPaymentId(null);
          }
        }}
      >
        <DialogContent
          className={
            takenPaymentId === null
              ? "max-h-[calc(100vh-2rem)] max-w-md overflow-y-auto"
              : // The code is held up for someone to scan across a counter, so
                // this view gets room to breathe that a form does not need.
                "max-h-[calc(100vh-2rem)] max-w-3xl overflow-y-auto p-6 sm:p-8"
          }
        >
          <DialogHeader>
            <DialogTitle>{charging?.title ?? "Take payment"}</DialogTitle>
            <DialogDescription>
              {takenPaymentId === null
                ? "Their wallet decides what they send, not your settlement asset."
                : "Hold this up for the customer to scan."}
            </DialogDescription>
          </DialogHeader>

          {failure !== "" && <Alert variant="destructive">{failure}</Alert>}

          {takenPaymentId === null ? (
            <div className="flex flex-col gap-4">
              {/* The counter types the amount, then picks how it is paid. The
                  reverse order asked them to choose a rail before the figure it
                  would be priced against was on screen. */}
              {charging?.kind === "open" && (
                <Field>
                  <FieldLabel htmlFor="charge-amount">Amount</FieldLabel>
                  <CurrencyInput
                    id="charge-amount"
                    asset={charging.currency ?? "IDR"}
                    value={chargeAmount}
                    // Priced when the field is left rather than on every
                    // keystroke: each quote is a rate lookup, and pricing
                    // "7", "75", "750" costs three of them to show two
                    // numbers nobody read.
                    onBlur={() => {
                      if (
                        charging !== null &&
                        isValidAmount(chargeAmount, charging.currency ?? "IDR")
                      ) {
                        void priceIt(charging, chargeAmount.trim(), chargingRailChains);
                      }
                    }}
                    onValueChange={setChargeAmount}
                    placeholder="75.000,00"
                  />
                  <FieldDescription>
                    What this customer owes, in your own currency.
                  </FieldDescription>
                </Field>
              )}

              {chargeSource !== "" && (
                <div className="flex items-baseline justify-between gap-3 rounded-md border border-border bg-accent/40 px-3 py-2">
                  <span className="text-muted-foreground text-xs">Charging</span>
                  <span className="font-semibold text-base text-foreground tabular-nums">
                    {chargeSource}
                  </span>
                </div>
              )}

              {chargingRails.length === 0 ? (
                <Alert role="status">
                  No network can take a payment for you yet — see which ones and why in{" "}
                  <a href="/wallets" className="underline">
                    wallets
                  </a>
                  .
                </Alert>
              ) : (
                // One list, not a picker above a price table. The two showed
                // the same assets in two orders — one with networks, one
                // without — and neither said which figure the customer would
                // actually be asked for. Here a row *is* the choice, and it
                // carries its own number.
                <RailChoice
                  rails={chargingRails}
                  value={chargeRail}
                  onSelect={setChargeRail}
                  lineFor={lineFor}
                  pending={quote.isPending}
                />
              )}
            </div>
          ) : (
            <DepositQr paymentIntentId={takenPaymentId} />
          )}

          <DialogFooter>
            <DialogClose
              render={
                <Button variant="secondary" className="px-8">
                  Close
                </Button>
              }
            />
            {takenPaymentId === null ? (
              <Button
                onClick={takePayment}
                // An asset the quote could not price cannot be charged either:
                // the quote reads the same source the price lock reads, so
                // starting anyway would mint a payment that fails on arrival.
                disabled={
                  chargeRail === "" ||
                  charge.isPending ||
                  quote.isPending ||
                  (charging?.kind === "open" &&
                    !isValidAmount(chargeAmount, charging.currency ?? "IDR")) ||
                  selectedQuote?.available === false
                }
              >
                Start payment
              </Button>
            ) : (
              <Button
                onClick={() => {
                  window.location.href = `/payments/${encodeURIComponent(takenPaymentId)}`;
                }}
              >
                <ReceiptIcon size={14} aria-hidden="true" />
                Open payment
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sharing the link itself: a web address, for sending to someone. */}
      <Dialog open={sharing !== null} onOpenChange={(next) => !next && setSharing(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{sharing?.title ?? "Payment link"}</DialogTitle>
            <DialogDescription>
              Send this to a customer. It opens a checkout page in their browser, and each visitor
              gets their own payment with its own address.
            </DialogDescription>
          </DialogHeader>

          {sharing !== null && (
            <div className="flex flex-col items-center gap-3">
              {/* This code is a URL. A wallet scanning it would open a browser,
                  not a transfer — which is why it says so rather than sitting
                  next to a wallet icon and being mistaken for a payment code. */}
              <img
                src={qrSrc(sharing)}
                alt={`QR code that opens ${sharing.url}`}
                className="size-60 bg-white p-2"
              />
              <a
                href={qrSrc(sharing, true)}
                download="mayarin-payment-qr.png"
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                <DownloadSimpleIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                Download QR
              </a>
              <p className="text-center text-sm text-muted-foreground">
                Opens the checkout page. To be paid by a wallet scan instead, use{" "}
                <strong className="font-medium text-foreground">Take payment</strong>.
              </p>
              <CheckoutLinkCard
                url={sharing.url}
                copied={copied === sharing.id}
                onCopy={() => void copy(sharing.url, sharing.id)}
              />
            </div>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Close</Button>} />
            {sharing !== null && (
              <Button onClick={() => window.open(sharing.url, "_blank", "noreferrer")}>
                Open checkout
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDisable !== null}
        onOpenChange={(next) => !next && setPendingDisable(null)}
      >
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Retire this link?</AlertDialogTitle>
            <AlertDialogDescription>
              Nobody can start a new payment from it. Payments already taken through it are
              unaffected — they are payments, not part of the link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel />
            <AlertDialogAction
              onClick={() => {
                if (pendingDisable !== null) {
                  void disable.mutateAsync(pendingDisable.id).catch(() => {
                    setFailure("Could not retire the link");
                  });
                }
                setPendingDisable(null);
              }}
            >
              Retire
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

export default withQuery(PaymentLinks);

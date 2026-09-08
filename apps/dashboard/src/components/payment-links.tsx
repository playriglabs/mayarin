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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
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
import {
  useChargeLink,
  useCreateLink,
  useDisableLink,
  usePaymentLinks,
  useProductOptions,
  useQuoteLink,
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
import type { PaymentLinkDto, PaymentLinkKind, QuoteLine, QuoteResponse } from "@/types/catalog";
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

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
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
  /** Every network with a rail, in catalog order — what a quote is asked for. */
  const railChains = [...new Set(payerRails.map((rail) => rail.chain))];

  const canCreate = match(draft.kind)
    .with("fixed", () => isValidAmount(draft.amount, draft.currency))
    .with("open", () => true)
    .with("catalog", () => draft.productId !== "" && Number(draft.quantity) > 0)
    .exhaustive();

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
        currency: draft.currency,
        lines: [{ productId: draft.productId, quantity: Number(draft.quantity) }],
      }))
      .exhaustive();

    try {
      const { paymentLink } = await create.mutateAsync({
        ...shape,
        ...(title === "" ? {} : { title }),
        ...(reference === "" ? {} : { merchantReference: reference }),
      });
      setCreating(false);
      setDraft(EMPTY_DRAFT);
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
    const first = payerRails[0];
    setChargeRail(first === undefined ? "" : `${first.chain}:${first.asset}`);
    setCharging(link);
    // A link that carries its own amount can be priced immediately. An open one
    // has nothing to price until the counter types a figure.
    if (link.kind !== "open") void priceIt(link, undefined, railChains);
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
        <Button
          onClick={() => {
            setFailure("");
            setCreating(true);
          }}
          disabled={!profileReady}
        >
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
                <Button
                  onClick={() => {
                    setFailure("");
                    setCreating(true);
                  }}
                  disabled={!profileReady}
                >
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
                            onClick={() => setSharing(link)}
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
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New payment link</DialogTitle>
            <DialogDescription>
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

            <Field>
              <FieldLabel htmlFor="link-currency">Currency</FieldLabel>
              <Select
                items={CURRENCY_OPTIONS}
                value={draft.currency}
                onValueChange={(next) => setDraft({ ...draft, currency: next })}
              >
                <SelectTrigger id="link-currency">
                  <SelectValue placeholder="Select a currency" />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

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
                      onValueChange={(next) => setDraft({ ...draft, productId: next })}
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
                        void priceIt(charging, chargeAmount.trim(), railChains);
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

              {payerRails.length === 0 ? (
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
                  rails={payerRails}
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
            <DialogClose render={<Button variant="secondary">Close</Button>} />
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
        <AlertDialogContent>
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

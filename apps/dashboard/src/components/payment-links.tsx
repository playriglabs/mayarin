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
  LinkIcon,
  PackageIcon,
  PlusIcon,
  QrCodeIcon,
  ShareNetworkIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { match } from "ts-pattern";
import { AssetLabel } from "@/components/asset-logo";
import { ChainLabel } from "@/components/chain-logo";
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
import { withQuery } from "@/lib/with-query";
import type { PaymentLinkDto, PaymentLinkKind, QuoteResponse } from "@/types/catalog";

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
function qrSrc(link: PaymentLinkDto): string {
  const origin = new URL(link.url).origin;
  return `${origin}/checkout/qr?value=${encodeURIComponent(link.url)}`;
}

function amountLabel(link: PaymentLinkDto): string {
  if (link.amount !== null) return link.amount.display;
  if (link.kind === "open") return `Buyer enters (${link.currency ?? "—"})`;
  return `Catalog (${link.currency ?? "—"})`;
}

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load payment links";
}

/** One rail in the counter's picker: the asset, with the network it is sent on. */
function RailOption({ value }: { readonly value: string }) {
  const [chain = "", asset = ""] = value.split(":");
  return (
    <span className="flex items-center gap-2">
      <AssetLabel symbol={asset} />
      <ChainLabel chain={chain} size={18} className="text-muted-foreground text-xs" />
    </span>
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
  /** What each accepted asset would take, for the amount on screen. */
  const [quoted, setQuoted] = useState<QuoteResponse | null>(null);
  const [pendingDisable, setPendingDisable] = useState<PaymentLinkDto | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const rows = links.data?.paymentLinks ?? [];
  const [chargeChain = "", chargeAsset = ""] = chargeRail.split(":");
  /** The priced line for the asset the counter has selected, once one exists. */
  const selectedQuote = quoted?.quotes.find((line) => line.asset === chargeAsset);
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
  const railOptions: readonly SelectOption[] = payerRails.map((rail) => ({
    value: `${rail.chain}:${rail.asset}`,
    label: `${rail.asset} · ${chainLabel(rail.chain)}`,
  }));

  const canCreate = match(draft.kind)
    .with("fixed", () => isValidAmount(draft.amount, draft.currency))
    .with("open", () => true)
    .with("catalog", () => draft.productId !== "" && Number(draft.quantity) > 0)
    .exhaustive();

  /**
   * Clipboard access is refused on an insecure origin and by a denied
   * permission, and a merchant who gets neither the tick nor a message is
   * looking at a button that appears broken. The URL is on screen either way,
   * so the fallback is to say so rather than to retry.
   */
  async function copy(value: string, id: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      setNotice("Link copied.");
      window.setTimeout(() => setCopied(null), 2_000);
    } catch {
      setFailure("Could not reach the clipboard — copy the link from the dialog instead.");
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
    setQuoted(null);
    setChargeRail(railOptions[0]?.value ?? "");
    setCharging(link);
    // A link that carries its own amount can be priced immediately. An open one
    // has nothing to price until the counter types a figure.
    if (link.kind !== "open") void priceIt(link, undefined);
  }

  /**
   * Prices the sale in every accepted asset.
   *
   * A failure here is not a failure of the sale: the merchant can still take
   * the payment in whichever asset they pick, and the amount is locked
   * server-side when it is confirmed. So it clears the table rather than
   * blocking the button.
   */
  async function priceIt(link: PaymentLinkDto, amount: string | undefined) {
    try {
      setQuoted(
        await quote.mutateAsync({
          linkId: link.id,
          ...(amount === undefined ? {} : { amount: { amount, asset: link.currency ?? "IDR" } }),
        }),
      );
    } catch {
      setQuoted(null);
    }
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
              : "max-h-[calc(100vh-2rem)] max-w-3xl overflow-y-auto"
          }
        >
          <DialogHeader>
            <DialogTitle>{charging?.title ?? "Take payment"}</DialogTitle>
            <DialogDescription>
              {takenPaymentId === null
                ? "Pick what the customer is paying with. Their wallet decides this, not your settlement asset."
                : "Hold this up for the customer to scan."}
            </DialogDescription>
          </DialogHeader>

          {failure !== "" && <Alert variant="destructive">{failure}</Alert>}

          {takenPaymentId === null ? (
            <div className="flex flex-col gap-3">
              {payerRails.length === 0 ? (
                <Alert role="status">
                  No network can take a payment for you yet — see which ones and why in{" "}
                  <a href="/wallets" className="underline">
                    wallets
                  </a>
                  .
                </Alert>
              ) : (
                <Field>
                  <FieldLabel htmlFor="charge-rail">Paying with</FieldLabel>
                  <Select items={railOptions} value={chargeRail} onValueChange={setChargeRail}>
                    <SelectTrigger id="charge-rail">
                      <SelectValue
                        placeholder="Select an asset and network"
                        renderValue={(option) => <RailOption value={option.value} />}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {railOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          <RailOption value={option.value} />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Whatever they send is converted to your settlement asset before it reaches you.
                    The address they scan belongs to this network only.
                  </FieldDescription>
                </Field>
              )}

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
                        void priceIt(charging, chargeAmount.trim());
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

              {/* What the customer would send, per accepted asset. Indicative:
                  the figure they are actually charged is locked when the
                  payment is confirmed, a moment later. */}
              {quote.isPending ? (
                <PageLoader
                  label="Fetching payment quote"
                  size={32}
                  className="min-h-16 border-border border-t pt-3"
                />
              ) : quoted !== null ? (
                <div className="flex flex-col gap-2 border-t border-border pt-3">
                  <p className="label text-muted-foreground mb-2">
                    {quoted.source.display} is about
                  </p>
                  <ul className="flex flex-col gap-1">
                    {quoted.quotes.map((line) => (
                      <li
                        key={line.asset}
                        className="flex items-baseline justify-between gap-3 text-sm"
                      >
                        <AssetLabel
                          symbol={line.asset}
                          size={18}
                          className="text-muted-foreground"
                        />
                        {line.available && line.amount !== null ? (
                          <span className="font-medium text-foreground">{line.amount.display}</span>
                        ) : (
                          // The reason, not "No rate": a missing oracle feed is
                          // an operator's fix, and a blank refusal sends them
                          // looking at the customer instead.
                          <span className="text-right text-subtle-foreground text-xs">
                            {line.reason ?? "No rate"}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-subtle-foreground mt-1">
                    Indicative. The exact amount is locked when you start the payment.
                  </p>
                </div>
              ) : null}
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
                Open payment
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sharing the link itself: a web address, for sending to someone. */}
      <Dialog open={sharing !== null} onOpenChange={(next) => !next && setSharing(null)}>
        <DialogContent>
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
                className="size-56 bg-white p-2"
              />
              <p className="text-center text-sm text-muted-foreground">
                Opens the checkout page. To be paid by a wallet scan instead, use{" "}
                <strong className="font-medium text-foreground">Take payment</strong>.
              </p>
              <p className="w-full break-all text-center font-mono text-xs text-muted-foreground">
                {sharing.url}
              </p>
              <Button variant="secondary" onClick={() => void copy(sharing.url, sharing.id)}>
                {copied === sharing.id ? (
                  <CheckIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                ) : (
                  <CopyIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                )}
                Copy link
              </Button>
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

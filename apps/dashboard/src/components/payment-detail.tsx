/**
 * Payment detail — a React island over `GET /payments/:id`.
 *
 * Three panels: what the payer was asked for, what clearing did with it, and
 * the state machine that carried it. A payment with no clearing transaction yet
 * shows the first and third only — the middle panel is absent rather than
 * filled with dashes, because "not started" and "zero" are different facts.
 */

import { type CartSnapshot, parseCartSnapshot } from "@mayarin/catalog";
import { addressExplorerUrl, transactionExplorerUrl } from "@mayarin/chain";
import { formatMoneyLocale, money } from "@mayarin/shared";
import { getAsset, isAssetCode } from "@mayarin/shared/asset";
import {
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  DownloadSimpleIcon,
} from "@phosphor-icons/react";
import { match, P } from "ts-pattern";
import { AssetAmount, AssetLabel } from "@/components/asset-logo";
import { ChainLabel } from "@/components/chain-logo";
import { DepositQr } from "@/components/deposit-qr";
import { DetailRow } from "@/components/detail-row";
import { EscrowPanel } from "@/components/escrow-panel";
import { FundingCard } from "@/components/funding-card";
import { PaymentMethodMark } from "@/components/payment-method-mark";
import PaymentTimeline from "@/components/payment-timeline";
import { TransactionLink } from "@/components/transaction-link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/page-loader";
import { QueryError } from "@/components/ui/query-error";
import { SectionHeader } from "@/components/ui/section-header";
import { useDeposit, useFunding, usePayment, useRetrySettlement } from "@/hooks/payments";
import { ApiError } from "@/lib/api/client";
import { intentStatusLabel, labelOf, stepIndex, toneOf } from "@/lib/clearing";
import { formatDateTime, isoAttr } from "@/lib/date";
import { withQuery } from "@/lib/with-query";

function reasonOf(error: unknown): string {
  return match(error)
    .when(
      (e): e is ApiError => e instanceof ApiError && e.status === 404,
      () => "No payment with that id belongs to this merchant.",
    )
    .when(
      (e): e is ApiError => e instanceof ApiError,
      (e) => e.message,
    )
    .otherwise(() => "Failed to load this payment");
}

/** Human currency identity; the code disambiguates symbols shared by markets. */
function assetName(code: string): string {
  return isAssetCode(code) ? `${getAsset(code).name} (${code})` : code;
}

/** Statuses after which there is nothing left for a payer to send. */
const TERMINAL_STATUSES: readonly string[] = ["COMPLETED", "FAILED", "EXPIRED"];

/**
 * Where this payment came from, read off the intent's metadata.
 *
 * The commerce layer stamps what minted the intent: an invoice checkout writes
 * `invoiceId`, a link checkout writes `paymentLinkId`, anything that priced a
 * cart writes the `cart` snapshot, and an agent endpoint writes
 * `x402Resource`. A payment with none of those was created straight through the
 * API — by a QR scan or a server integration.
 *
 * An agent can also pay an obligation that already existed (#273): the same
 * `invoiceId`/`paymentLinkId` metadata carries an `x402PayableKind` marker,
 * and the label names the rail rather than the obligation, because the
 * merchant's first question about an agent payment is that it *was* one.
 */
interface Purchase {
  readonly label: string;
  /** The minting record's id, when one exists. */
  readonly reference?: string;
  readonly cart?: CartSnapshot;
}

function purchaseOf(intent: {
  readonly metadata: Readonly<Record<string, string>>;
  readonly source: { readonly type: "qr"; readonly scheme: string } | { readonly type: "manual" };
}): Purchase {
  const raw = intent.metadata.cart;
  const cart = raw === undefined ? undefined : parseCartSnapshot(raw);
  const invoiceId = intent.metadata.invoiceId;
  const linkId = intent.metadata.paymentLinkId;

  // An x402 payment is a machine paying for one endpoint or one obligation, and
  // its source is `manual` only because nobody scanned anything. Calling it
  // "Direct API" describes a server integration holding a key — the opposite
  // of a payer that has never registered with anyone.
  if (intent.metadata.x402PayableKind !== undefined) {
    const payableId = intent.metadata.x402PayableId;
    return {
      label: "Agent · x402",
      ...(payableId === undefined ? {} : { reference: payableId }),
    };
  }
  if (intent.metadata.x402Resource !== undefined) {
    return { label: "Agent · x402", reference: intent.metadata.x402Resource };
  }
  if (invoiceId !== undefined) {
    return { label: "Invoice", reference: invoiceId, ...(cart === undefined ? {} : { cart }) };
  }
  if (linkId !== undefined) {
    return { label: "Payment link", reference: linkId, ...(cart === undefined ? {} : { cart }) };
  }
  if (cart !== undefined) {
    return { label: "Product catalog", cart };
  }
  return intent.source.type === "qr"
    ? { label: `QR scan · ${intent.source.scheme}` }
    : { label: "Direct API" };
}

/** A snapshot amount, in the human form. Minor units stay strings until here. */
function snapshotDisplay(amount: string, currency: CartSnapshot["currency"]): string {
  return formatMoneyLocale(money(BigInt(amount), currency), { trimTrailingZeros: true });
}

/**
 * What was bought, when the intent carries a cart snapshot.
 *
 * The snapshot is a receipt: clearing settles `intent.amount`, and these lines
 * exist so a merchant reading a payment can answer "for what?" without opening
 * the orders page. Unit prices are shown per line; the total is the snapshot's
 * own, never re-added here.
 */
function CartItems({ cart }: { readonly cart: CartSnapshot }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="Items" />
      <Card>
        <dl className="flex flex-col">
          {cart.lines.map((line, index) => (
            <DetailRow
              // biome-ignore lint/suspicious/noArrayIndexKey: a frozen receipt, lines never reorder
              key={index}
              label={line.quantity === 1 ? line.name : `${line.name} × ${line.quantity}`}
            >
              {snapshotDisplay(line.unitPrice, cart.currency)}
            </DetailRow>
          ))}
          <DetailRow label="Total">
            <span className="font-medium">{snapshotDisplay(cart.total, cart.currency)}</span>
          </DetailRow>
        </dl>
      </Card>
    </section>
  );
}

function PaymentDetail({ id }: { id: string }) {
  const payment = usePayment(id);
  const status = payment.data?.paymentIntent.status;
  // A terminal intent has nothing left for a payer to send, so the deposit view
  // is hidden (below) and its poll is switched off — see `useDeposit`.
  const live = status === undefined || !TERMINAL_STATUSES.includes(status);
  const deposit = useDeposit(id, live);
  // A payer who paid in their own currency has no wallet to scan from: the code
  // below is replaced by what they actually did.
  const funding = useFunding(id, live).data?.funding ?? null;
  // Called unconditionally: the button it drives is rendered only on a FAILED
  // payment, and a hook behind that render would be a conditional one.
  const retry = useRetrySettlement(id);

  return (
    <section className="flex flex-col gap-6">
      <a
        href="/payments"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon size={14} weight="bold" aria-hidden="true" />
        All payments
      </a>

      {match(payment)
        .with({ status: "pending" }, () => (
          <PageLoader label="Loading payment" className="min-h-128" />
        ))
        .with({ status: "error" }, ({ error }) => (
          <QueryError
            message={reasonOf(error)}
            retry={() => void payment.refetch()}
            retrying={payment.isFetching}
          />
        ))
        .with({ status: "success" }, ({ data }) => {
          const { paymentIntent: intent, clearing, timeline, documents } = data;
          const payerDeposit = deposit.data?.deposit;
          const purchase = purchaseOf(intent);
          // The contract path carries an on-chain transaction hash; the deposit
          // path does not — its on-chain footprint is the payer's transfer to the
          // deposit address. A merchant can only "see it on chain" once the asset
          // has actually arrived, so before ASSET_RECEIVED there is nothing to
          // show, and at or after it the deposit path links to the address page.
          const explorerUrl = match({
            payment: intent.payment,
            transactionHash: clearing?.transactionHash ?? null,
            deposit: payerDeposit,
            state: clearing?.state ?? "CREATED",
          })
            .with({ payment: null }, () => undefined)
            .with(
              { payment: P.nonNullable, transactionHash: P.nonNullable },
              ({ payment, transactionHash }) =>
                transactionExplorerUrl(payment.chain, transactionHash),
            )
            .with(
              {
                deposit: P.nonNullable,
                state: P.when((s) => stepIndex(s) >= stepIndex("ASSET_RECEIVED")),
              },
              ({ deposit }) => addressExplorerUrl(deposit.chain, deposit.address),
            )
            .otherwise(() => undefined);

          return (
            <div className="flex flex-col gap-6">
              <header className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <h1 className="truncate font-mono text-[18px] md:text-2xl font-medium text-foreground">
                    {intent.id}
                  </h1>
                  <p className="text-sm text-muted-foreground mt-2">
                    {intent.merchant.name} · {intent.merchant.city}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {/* A failed payment can be retried once whatever broke it is
                      fixed — the button disappears with the FAILED status it
                      clears, because the invalidated detail reads back
                      PROCESSING. A payment that must not be retried answers
                      with the reason, as a toast from the mutation. */}
                  {intent.status === "FAILED" && clearing !== null && (
                    <Button
                      variant="secondary"
                      onClick={() => void retry.mutateAsync()}
                      disabled={retry.isPending}
                    >
                      <ArrowsClockwiseIcon size={14} aria-hidden="true" />
                      Retry settlement
                    </Button>
                  )}
                  <a
                    href={documents.invoiceUrl}
                    download
                    className={buttonVariants({ variant: "secondary" })}
                  >
                    <DownloadSimpleIcon size={14} aria-hidden="true" />
                    Invoice
                  </a>
                  {documents.receiptUrl !== null && (
                    <a
                      href={documents.receiptUrl}
                      download
                      className={buttonVariants({ variant: "secondary" })}
                    >
                      <DownloadSimpleIcon size={14} aria-hidden="true" />
                      Receipt
                    </a>
                  )}
                  {explorerUrl !== undefined && (
                    <a
                      href={explorerUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className={buttonVariants({ variant: "secondary" })}
                    >
                      View on blockchain
                      <ArrowSquareOutIcon size={14} aria-hidden="true" />
                    </a>
                  )}
                  <Badge variant={toneOf(intent.status)}>{intentStatusLabel(intent.status)}</Badge>
                </div>
              </header>

              {intent.escrow !== null &&
                intent.payment !== null &&
                intent.status === "COMPLETED" && (
                  <EscrowPanel id={intent.id} chain={intent.payment.chain} />
                )}

              {/* The code the payer scans, while there is still a payment to
                  pay. Shown above everything else because a merchant opening a
                  pending payment is almost always opening it to show this — and
                  it disappears on its own once the payment is terminal. */}
              {!TERMINAL_STATUSES.includes(intent.status) && (
                <section className="flex flex-col gap-3">
                  <SectionHeader title={funding === null ? "Payment code" : "Funding"} />
                  <Card>
                    {funding === null ? (
                      <DepositQr paymentIntentId={intent.id} />
                    ) : (
                      <FundingCard funding={funding} />
                    )}
                  </Card>
                </section>
              )}

              <div className="grid gap-8 md:grid-cols-2 md:gap-4">
                <section className="flex flex-col gap-3">
                  <SectionHeader title="Payment intent" />
                  <Card className="flex-1">
                    <dl className="flex flex-col">
                      <DetailRow label="Customer amount">{intent.amount.display}</DetailRow>
                      <DetailRow label="Customer currency">
                        {assetName(intent.amount.asset)}
                      </DetailRow>
                      <DetailRow label="Settles in">
                        <AssetLabel symbol={intent.settlementAsset} size={18} />
                      </DetailRow>
                      <DetailRow label="Provider">{intent.provider}</DetailRow>
                      {funding !== null && intent.payment !== null && (
                        <DetailRow label="Delivered as">
                          <span className="inline-flex items-center gap-1.5">
                            <AssetLabel symbol={intent.payment.asset} size={18} />
                            <span>on</span>
                            <ChainLabel chain={intent.payment.chain} size={18} />
                          </span>
                        </DetailRow>
                      )}
                      <DetailRow label="Payer rail">
                        {funding !== null ? (
                          <PaymentMethodMark
                            name={funding.paymentName}
                            logoUrl={funding.paymentLogoUrl}
                          />
                        ) : intent.payment === null ? (
                          <span className="text-subtle-foreground">Not selected</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5">
                            <AssetLabel symbol={intent.payment.asset} size={18} />
                            <span>on</span>
                            <ChainLabel chain={intent.payment.chain} size={18} />
                          </span>
                        )}
                      </DetailRow>
                      <DetailRow label="Purchased via">
                        <span className="inline-flex flex-wrap items-baseline justify-end gap-1.5">
                          <span>{purchase.label}</span>
                          {purchase.reference !== undefined && (
                            <span className="break-all font-mono text-xs text-muted-foreground">
                              {purchase.reference}
                            </span>
                          )}
                        </span>
                      </DetailRow>
                      <DetailRow label="Created">
                        <time dateTime={isoAttr(intent.createdAt)}>
                          {formatDateTime(intent.createdAt)}
                        </time>
                      </DetailRow>
                      <DetailRow label="Expires">
                        <time dateTime={isoAttr(intent.expiresAt)}>
                          {formatDateTime(intent.expiresAt)}
                        </time>
                      </DetailRow>
                    </dl>
                  </Card>
                </section>

                {clearing !== null && (
                  <section className="flex flex-col gap-3">
                    <SectionHeader title="Clearing" />
                    <Card className="flex-1">
                      <dl className="flex flex-col">
                        <DetailRow label="State">
                          <Badge variant={toneOf(clearing.state)}>{labelOf(clearing.state)}</Badge>
                        </DetailRow>
                        <DetailRow label="Priced amount">{clearing.sourceAmount.display}</DetailRow>
                        <DetailRow label="Payer sends">
                          {deposit.isPending ? (
                            <span className="text-subtle-foreground">Loading…</span>
                          ) : payerDeposit == null ? (
                            <span className="text-subtle-foreground">—</span>
                          ) : (
                            <AssetAmount
                              asset={payerDeposit.asset}
                              display={payerDeposit.amount.display}
                            />
                          )}
                        </DetailRow>
                        <DetailRow label="Received">
                          {deposit.isPending ? (
                            <span className="text-subtle-foreground">Loading…</span>
                          ) : payerDeposit == null ? (
                            <span className="text-subtle-foreground">—</span>
                          ) : (
                            <AssetAmount
                              asset={payerDeposit.asset}
                              display={payerDeposit.received.display}
                            />
                          )}
                        </DetailRow>
                        <DetailRow label="Settlement">
                          {clearing.settlementAmount === null ? (
                            <span className="text-subtle-foreground">Not priced yet</span>
                          ) : (
                            <AssetAmount
                              asset={clearing.settlementAmount.asset}
                              display={clearing.settlementAmount.display}
                            />
                          )}
                        </DetailRow>
                        <DetailRow label="Fee">
                          {clearing.fee === null ? (
                            <span className="text-subtle-foreground">—</span>
                          ) : (
                            <AssetAmount
                              asset={clearing.fee.asset}
                              display={clearing.fee.display}
                            />
                          )}
                        </DetailRow>
                        <DetailRow label="Net to merchant">
                          {clearing.netAmount === null ? (
                            <span className="text-subtle-foreground">—</span>
                          ) : (
                            <AssetAmount
                              asset={clearing.netAmount.asset}
                              display={clearing.netAmount.display}
                            />
                          )}
                        </DetailRow>
                        <DetailRow label="Locked rate">
                          {clearing.rate === null ? (
                            <span className="text-subtle-foreground">Not locked</span>
                          ) : (
                            <span className="font-mono text-xs">
                              {clearing.rate.from}/{clearing.rate.to} · {clearing.rate.source}
                            </span>
                          )}
                        </DetailRow>
                        <DetailRow label="Provider reference">
                          {clearing.providerReference === null ? (
                            <span className="text-subtle-foreground">—</span>
                          ) : (
                            <TransactionLink
                              chain={intent.payment?.chain ?? ""}
                              transactionHash={clearing.providerReference}
                            />
                          )}
                        </DetailRow>
                      </dl>
                    </Card>
                  </section>
                )}
              </div>

              {purchase.cart !== undefined && <CartItems cart={purchase.cart} />}

              <section className="flex flex-col gap-3">
                <SectionHeader title="Clearing timeline" />
                <Card className="gap-4">
                  <PaymentTimeline
                    events={timeline}
                    currentState={clearing?.state ?? "CREATED"}
                    failureReason={clearing?.failure?.reason ?? intent.failureReason ?? undefined}
                  />
                </Card>
              </section>
            </div>
          );
        })
        .exhaustive()}
    </section>
  );
}

export default withQuery(PaymentDetail);

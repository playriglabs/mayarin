/**
 * Payment detail — a React island over `GET /payments/:id`.
 *
 * Three panels: what the payer was asked for, what clearing did with it, and
 * the state machine that carried it. A payment with no clearing transaction yet
 * shows the first and third only — the middle panel is absent rather than
 * filled with dashes, because "not started" and "zero" are different facts.
 */

import { type CartSnapshot, parseCartSnapshot } from "@mayarin/catalog";
import { formatMoneyLocale, money } from "@mayarin/shared";
import { getAsset, isAssetCode } from "@mayarin/shared/asset";
import { ArrowLeftIcon, ArrowSquareOutIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { match, P } from "ts-pattern";
import { AssetAmount, AssetLabel } from "@/components/asset-logo";
import { ChainLabel } from "@/components/chain-logo";
import { DepositQr } from "@/components/deposit-qr";
import PaymentTimeline from "@/components/payment-timeline";
import { TransactionLink } from "@/components/transaction-link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/page-loader";
import { QueryError } from "@/components/ui/query-error";
import { SectionHeader } from "@/components/ui/section-header";
import { useDeposit, usePayment } from "@/hooks/payments";
import { ApiError } from "@/lib/api/client";
import { addressExplorerUrl, transactionExplorerUrl } from "@/lib/chain-explorer";
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

/** One key/value line. Rendered inside a `<dl>` so the pairing is real. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-b-0">
      <dt className="shrink-0 text-sm text-foreground/50">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-foreground">{children}</dd>
    </div>
  );
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

  if (invoiceId !== undefined) {
    return { label: "Invoice", reference: invoiceId, ...(cart === undefined ? {} : { cart }) };
  }
  if (linkId !== undefined) {
    return { label: "Payment link", reference: linkId, ...(cart === undefined ? {} : { cart }) };
  }
  if (cart !== undefined) {
    return { label: "Product catalog", cart };
  }
  // An x402 payment is a machine paying for one endpoint, and its source is
  // `manual` only because nobody scanned anything. Calling it "Direct API"
  // describes a server integration holding a key — the opposite of a payer that
  // has never registered with anyone.
  const resourceId = intent.metadata.x402Resource;
  if (resourceId !== undefined) {
    return { label: "Agent · x402", reference: resourceId };
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
            <Row
              // biome-ignore lint/suspicious/noArrayIndexKey: a frozen receipt, lines never reorder
              key={index}
              label={line.quantity === 1 ? line.name : `${line.name} × ${line.quantity}`}
            >
              {snapshotDisplay(line.unitPrice, cart.currency)}
            </Row>
          ))}
          <Row label="Total">
            <span className="font-medium">{snapshotDisplay(cart.total, cart.currency)}</span>
          </Row>
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
  const deposit = useDeposit(id, status === undefined || !TERMINAL_STATUSES.includes(status));

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
          const { paymentIntent: intent, clearing, timeline } = data;
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

              {/* The code the payer scans, while there is still a payment to
                  pay. Shown above everything else because a merchant opening a
                  pending payment is almost always opening it to show this — and
                  it disappears on its own once the payment is terminal. */}
              {!TERMINAL_STATUSES.includes(intent.status) && (
                <section className="flex flex-col gap-3">
                  <SectionHeader title="Payment code" />
                  <Card>
                    <DepositQr paymentIntentId={intent.id} />
                  </Card>
                </section>
              )}

              <div className="grid gap-8 md:grid-cols-2 md:gap-4">
                <section className="flex flex-col gap-3">
                  <SectionHeader title="Payment intent" />
                  <Card className="flex-1">
                    <dl className="flex flex-col">
                      <Row label="Customer amount">{intent.amount.display}</Row>
                      <Row label="Customer currency">{assetName(intent.amount.asset)}</Row>
                      <Row label="Settles in">
                        <AssetLabel symbol={intent.settlementAsset} size={18} />
                      </Row>
                      <Row label="Provider">{intent.provider}</Row>
                      <Row label="Payer rail">
                        {intent.payment === null ? (
                          <span className="text-subtle-foreground">Not selected</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5">
                            <AssetLabel symbol={intent.payment.asset} size={18} />
                            <span>on</span>
                            <ChainLabel chain={intent.payment.chain} size={18} />
                          </span>
                        )}
                      </Row>
                      <Row label="Purchased via">
                        <span className="inline-flex flex-wrap items-baseline justify-end gap-1.5">
                          <span>{purchase.label}</span>
                          {purchase.reference !== undefined && (
                            <span className="break-all font-mono text-xs text-muted-foreground">
                              {purchase.reference}
                            </span>
                          )}
                        </span>
                      </Row>
                      <Row label="Created">
                        <time dateTime={isoAttr(intent.createdAt)}>
                          {formatDateTime(intent.createdAt)}
                        </time>
                      </Row>
                      <Row label="Expires">
                        <time dateTime={isoAttr(intent.expiresAt)}>
                          {formatDateTime(intent.expiresAt)}
                        </time>
                      </Row>
                    </dl>
                  </Card>
                </section>

                {clearing !== null && (
                  <section className="flex flex-col gap-3">
                    <SectionHeader title="Clearing" />
                    <Card className="flex-1">
                      <dl className="flex flex-col">
                        <Row label="State">
                          <Badge variant={toneOf(clearing.state)}>{labelOf(clearing.state)}</Badge>
                        </Row>
                        <Row label="Priced amount">{clearing.sourceAmount.display}</Row>
                        <Row label="Payer sends">
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
                        </Row>
                        <Row label="Received">
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
                        </Row>
                        <Row label="Settlement">
                          {clearing.settlementAmount === null ? (
                            <span className="text-subtle-foreground">Not priced yet</span>
                          ) : (
                            <AssetAmount
                              asset={clearing.settlementAmount.asset}
                              display={clearing.settlementAmount.display}
                            />
                          )}
                        </Row>
                        <Row label="Fee">
                          {clearing.fee === null ? (
                            <span className="text-subtle-foreground">—</span>
                          ) : (
                            <AssetAmount
                              asset={clearing.fee.asset}
                              display={clearing.fee.display}
                            />
                          )}
                        </Row>
                        <Row label="Net to merchant">
                          {clearing.netAmount === null ? (
                            <span className="text-subtle-foreground">—</span>
                          ) : (
                            <AssetAmount
                              asset={clearing.netAmount.asset}
                              display={clearing.netAmount.display}
                            />
                          )}
                        </Row>
                        <Row label="Locked rate">
                          {clearing.rate === null ? (
                            <span className="text-subtle-foreground">Not locked</span>
                          ) : (
                            <span className="font-mono text-xs">
                              {clearing.rate.from}/{clearing.rate.to} · {clearing.rate.source}
                            </span>
                          )}
                        </Row>
                        <Row label="Provider reference">
                          {clearing.providerReference === null ? (
                            <span className="text-subtle-foreground">—</span>
                          ) : (
                            <TransactionLink
                              chain={intent.payment?.chain ?? ""}
                              transactionHash={clearing.providerReference}
                            />
                          )}
                        </Row>
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

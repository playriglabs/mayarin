/**
 * Payment detail — a React island over `GET /payments/:id`.
 *
 * Three panels: what the payer was asked for, what clearing did with it, and
 * the state machine that carried it. A payment with no clearing transaction yet
 * shows the first and third only — the middle panel is absent rather than
 * filled with dashes, because "not started" and "zero" are different facts.
 */

import { ArrowLeftIcon, ArrowSquareOutIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { match, P } from "ts-pattern";
import { AssetAmount, AssetLabel } from "@/components/asset-logo";
import { DepositQr } from "@/components/deposit-qr";
import PaymentTimeline from "@/components/payment-timeline";
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
      <dt className="shrink-0 text-xs text-subtle-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-foreground">{children}</dd>
    </div>
  );
}

/** Statuses after which there is nothing left for a payer to send. */
const TERMINAL_STATUSES: readonly string[] = ["COMPLETED", "FAILED", "EXPIRED"];

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
                            <span>on {intent.payment.chain}</span>
                          </span>
                        )}
                      </Row>
                      <Row label="Source">
                        {intent.source.type === "qr" ? `QR · ${intent.source.scheme}` : "Manual"}
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
                            <span className="font-mono text-xs">{clearing.providerReference}</span>
                          )}
                        </Row>
                      </dl>
                    </Card>
                  </section>
                )}
              </div>

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

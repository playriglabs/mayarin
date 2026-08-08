/**
 * Payment detail — a React island over `GET /payments/:id`.
 *
 * Three panels: what the payer was asked for, what clearing did with it, and
 * the state machine that carried it. A payment with no clearing transaction yet
 * shows the first and third only — the middle panel is absent rather than
 * filled with dashes, because "not started" and "zero" are different facts.
 */

import {
  ArrowLeftIcon,
  CurrencyCircleDollarIcon,
  PathIcon,
  ReceiptIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { match } from "ts-pattern";
import PaymentTimeline from "@/components/payment-timeline";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePayment } from "@/hooks/payments";
import { ApiError } from "@/lib/api/client";
import { intentStatusLabel, labelOf, toneOf } from "@/lib/clearing";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD } from "@/lib/icons";
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

function PaymentDetail({ id }: { id: string }) {
  const payment = usePayment(id);

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
          <div role="status" aria-live="polite" className="flex flex-col gap-2">
            <span className="sr-only">Loading payment</span>
            <Skeleton aria-hidden="true" />
            <Skeleton aria-hidden="true" />
            <Skeleton aria-hidden="true" />
          </div>
        ))
        .with({ status: "error" }, ({ error }) => (
          <Alert variant="destructive">{reasonOf(error)}</Alert>
        ))
        .with({ status: "success" }, ({ data }) => {
          const { paymentIntent: intent, clearing, timeline } = data;
          return (
            <div className="flex flex-col gap-6">
              <header className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <h1 className="truncate font-mono text-2xl font-medium text-foreground">
                    {intent.id}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    {intent.merchant.name} · {intent.merchant.city}
                  </p>
                </div>
                <Badge variant={toneOf(intent.status)}>{intentStatusLabel(intent.status)}</Badge>
              </header>

              <div className="grid gap-4 md:grid-cols-2">
                <Card className="flex flex-col gap-3">
                  <CardTitle>
                    <ReceiptIcon
                      size={ICON_CARD}
                      weight="regular"
                      aria-hidden="true"
                      className="text-subtle-foreground"
                    />
                    Payment Intent
                  </CardTitle>
                  <dl className="flex flex-col">
                    <Row label="Amount">{intent.amount.formatted}</Row>
                    <Row label="Settles in">{intent.settlementAsset}</Row>
                    <Row label="Provider">{intent.provider}</Row>
                    <Row label="Payer rail">
                      {intent.payment === null ? (
                        <span className="text-subtle-foreground">Not selected</span>
                      ) : (
                        `${intent.payment.asset} on ${intent.payment.chain}`
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

                {clearing !== null && (
                  <Card className="flex flex-col gap-3">
                    <CardTitle>
                      <CurrencyCircleDollarIcon
                        size={ICON_CARD}
                        weight="regular"
                        aria-hidden="true"
                        className="text-subtle-foreground"
                      />
                      Clearing
                    </CardTitle>
                    <dl className="flex flex-col">
                      <Row label="State">
                        <Badge variant={toneOf(clearing.state)}>{labelOf(clearing.state)}</Badge>
                      </Row>
                      <Row label="Source amount">{clearing.sourceAmount.formatted}</Row>
                      <Row label="Settlement">
                        {clearing.settlementAmount?.formatted ?? (
                          <span className="text-subtle-foreground">Not priced yet</span>
                        )}
                      </Row>
                      <Row label="Fee">
                        {clearing.fee?.formatted ?? (
                          <span className="text-subtle-foreground">—</span>
                        )}
                      </Row>
                      <Row label="Net to merchant">
                        {clearing.netAmount?.formatted ?? (
                          <span className="text-subtle-foreground">—</span>
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
                )}
              </div>

              <Card className="flex flex-col gap-4">
                <CardTitle>
                  <PathIcon
                    size={ICON_CARD}
                    weight="regular"
                    aria-hidden="true"
                    className="text-subtle-foreground"
                  />
                  Clearing timeline
                </CardTitle>
                <PaymentTimeline
                  events={timeline}
                  currentState={clearing?.state ?? "CREATED"}
                  failureReason={clearing?.failure?.reason ?? intent.failureReason ?? undefined}
                />
              </Card>
            </div>
          );
        })
        .exhaustive()}
    </section>
  );
}

export default withQuery(PaymentDetail);

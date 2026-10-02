/**
 * One of the merchant's own disputes (#313): the thread on the left, the case
 * and the merchant's one move — refund the buyer — on the right.
 *
 * The merchant cannot release or split: those are the arbiter's, and the
 * factory refuses them from the payee. Refunding is always theirs, and closes
 * the dispute in the buyer's favour.
 */

import { chainLabel, shortHash } from "@mayarin/chain";
import { useState } from "react";
import { match } from "ts-pattern";
import { DetailRow } from "@/components/detail-row";
import { DisputeThread } from "@/components/dispute-thread";
import { deadlineTone } from "@/components/disputes-queue";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/page-loader";
import { QueryError } from "@/components/ui/query-error";
import { SectionHeader } from "@/components/ui/section-header";
import { useWalletPicker } from "@/components/wallet-picker";
import { useMerchantCaseMessage, useMerchantDisputeCase } from "@/hooks/disputes";
import { ApiError } from "@/lib/api/client";
import { formatDateTime } from "@/lib/date";
import { refundEscrow } from "@/lib/escrow-refund";
import { walletErrorMessage } from "@/lib/wallet";
import { withQuery } from "@/lib/with-query";
import type { DisputeCaseDto } from "@/types/payment";

const OUTCOME: Readonly<Record<DisputeCaseDto["escrow"]["outcome"], string>> = {
  held: "Waiting for the arbiter",
  released: "Released to you",
  split: "Split between you and the buyer",
  refunded: "Refunded to the buyer",
};

function MerchantDisputeCase({ id }: { readonly id: string }) {
  const found = useMerchantDisputeCase(id);
  const paymentId = found.data?.dispute.paymentIntentId ?? "";
  const postMessage = useMerchantCaseMessage(id, paymentId);
  const picker = useWalletPicker("The wallet that owns your settlement address, or its Safe.");
  const [refunding, setRefunding] = useState(false);
  const [error, setError] = useState<string | undefined>();

  function refund() {
    setError(undefined);
    const started = picker.pick((wallet) => {
      setRefunding(true);
      refundEscrow(paymentId, wallet)
        .then(() => found.refetch())
        .catch((cause: unknown) =>
          setError(cause instanceof ApiError ? cause.message : walletErrorMessage(cause)),
        )
        .finally(() => setRefunding(false));
    });
    if (!started) setError("No browser wallet found");
  }

  return match(found)
    .with({ status: "pending" }, () => <PageLoader label="Loading dispute" />)
    .with({ status: "error" }, ({ error: failure }) => (
      <QueryError
        message={failure instanceof ApiError ? failure.message : "Failed to load this dispute"}
        retry={() => void found.refetch()}
        retrying={found.isFetching}
      />
    ))
    .with({ status: "success" }, ({ data }) => {
      const { dispute, escrow } = data;
      const open = dispute.status === "open" && escrow.outcome === "held";
      return (
        <>
          <PageHeader
            title={`Dispute #${dispute.reference}`}
            description="Answer the buyer with your evidence. The arbiter reads both sides and decides."
          />
          <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-4">
            <section className="flex flex-col gap-3">
              <SectionHeader title="Conversation" />
              <Card>
                <DisputeThread
                  messages={data.messages}
                  viewer="merchant"
                  open={open}
                  pending={postMessage.isPending}
                  onSend={(body) => postMessage.mutateAsync(body)}
                />
              </Card>
            </section>

            <section className="flex flex-col gap-3">
              <SectionHeader title="Case" />
              <Card className="gap-0 p-0">
                <div className="flex items-start justify-between gap-3 border-b border-border p-4">
                  <div className="flex flex-col gap-1">
                    <p className="font-medium text-foreground text-sm">{OUTCOME[escrow.outcome]}</p>
                    {open && (
                      <p className="text-muted-foreground text-xs">
                        Undecided by the deadline, the buyer is refunded.
                      </p>
                    )}
                  </div>
                  {open ? (
                    <Badge variant={deadlineTone(dispute.resolveBy)}>
                      {formatDateTime(dispute.resolveBy)}
                    </Badge>
                  ) : (
                    <Badge variant="success">Decided</Badge>
                  )}
                </div>
                <dl className="flex flex-col px-4">
                  <DetailRow label="Payment">
                    <a
                      href={`/payments/${dispute.paymentIntentId}`}
                      className="font-mono text-xs underline decoration-input underline-offset-2 hover:decoration-foreground"
                    >
                      {dispute.paymentIntentId}
                    </a>
                  </DetailRow>
                  <DetailRow label="Network">{chainLabel(dispute.chain)}</DetailRow>
                  <DetailRow label="Buyer">
                    <span title={dispute.payer} className="font-mono text-xs">
                      {shortHash(dispute.payer)}
                    </span>
                  </DetailRow>
                  <DetailRow label="Buyer standing">
                    {escrow.payerStanding === "flagged" ? (
                      <Badge variant="warning">Flagged</Badge>
                    ) : (
                      <span className="text-muted-foreground">Good</span>
                    )}
                  </DetailRow>
                  <DetailRow label="Opened">{formatDateTime(dispute.openedAt)}</DetailRow>
                </dl>
                {open && (
                  <div className="flex flex-col gap-2 border-t border-border p-4">
                    <Button variant="secondary" disabled={refunding} onClick={refund}>
                      {refunding ? "Refunding…" : "Refund the buyer"}
                    </Button>
                    <p className="text-subtle-foreground text-xs">
                      Ends the dispute in the buyer's favour. Sent from your settlement wallet; for
                      a managed Safe, connect its owner wallet.
                    </p>
                    {error !== undefined && <p className="text-destructive text-sm">{error}</p>}
                  </div>
                )}
              </Card>
            </section>
          </div>
          {picker.picker}
        </>
      );
    })
    .exhaustive();
}

export default withQuery(MerchantDisputeCase);

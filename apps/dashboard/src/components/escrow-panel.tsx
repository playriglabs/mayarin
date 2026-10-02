/**
 * The hold on an escrowed payment (#304), on the payment detail.
 *
 * Where the funds are, read from the chain through the API, and the one move
 * the merchant has: refund the payer. Release is the payer's (or the clock's),
 * so it is not offered here. Mayarin signs nothing — the merchant's own wallet
 * sends the refund, and the factory accepts it only from the payee.
 */

import { addressExplorerUrl, shortHash } from "@mayarin/chain";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { Effect } from "effect";
import { useState } from "react";
import { DetailRow } from "@/components/detail-row";
import { DisputeThread } from "@/components/dispute-thread";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { useMerchantDisputeMessage } from "@/hooks/disputes";
import { useEscrow } from "@/hooks/payments";
import { ApiError } from "@/lib/api/client";
import { paymentsApi } from "@/lib/api/payments";
import { formatDateTime } from "@/lib/date";
import {
  discoverWallets,
  requestAccount,
  sendTransaction,
  switchChain,
  waitForReceipt,
  walletErrorMessage,
} from "@/lib/wallet";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function EscrowPanel({ id, chain }: { readonly id: string; readonly chain: string }) {
  const escrow = useEscrow(id);
  const postMessage = useMerchantDisputeMessage(id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const data = escrow.data?.escrow;
  if (data == null) return null;

  // Money still held is a waiting state (amber); a dispute needs attention (red).
  const [status, tone] =
    data.outcome === "released"
      ? (["Released", "success"] as const)
      : data.outcome === "refunded"
        ? (["Refunded", "default"] as const)
        : data.disputed
          ? (["Disputed", "destructive"] as const)
          : (["Held", "warning"] as const);
  const headline =
    data.outcome === "released"
      ? "Released to you"
      : data.outcome === "refunded"
        ? "Refunded to the payer"
        : data.disputed
          ? "Disputed by the payer — automatic release stopped"
          : `Releases to you on ${formatDateTime(data.terms.releaseAfter)}`;
  const hint =
    data.outcome !== "held"
      ? undefined
      : data.disputed
        ? data.terms.arbiter === ZERO_ADDRESS
          ? "Refund the payer to close it."
          : "The arbiter decides, or you refund the payer."
        : "The payer can release it early or open a dispute before then.";
  const explorer = addressExplorerUrl(chain, data.address);

  async function refund() {
    if (data == null) return;
    setBusy(true);
    setError(undefined);
    try {
      const [wallet] = await discoverWallets();
      if (wallet === undefined) throw new Error("No browser wallet found");
      const account = await requestAccount(wallet.provider);
      const { chainId, transaction } = await Effect.runPromise(
        paymentsApi.escrowRefund(id, account),
      );
      await switchChain(wallet.provider, BigInt(chainId));
      const hash = await sendTransaction(wallet.provider, transaction);
      await waitForReceipt(wallet.provider, hash);
      await escrow.refetch();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : walletErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="Escrow" />
      <Card className="gap-0 p-0">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-4">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-medium text-base text-foreground">{headline}</p>
            {hint !== undefined && <p className="text-muted-foreground text-sm">{hint}</p>}
          </div>
          <Badge variant={tone}>{status}</Badge>
        </div>

        <dl className="flex flex-col px-4">
          <DetailRow label="Escrow address">
            {explorer === undefined ? (
              <span title={data.address} className="font-mono text-xs">
                {shortHash(data.address)}
              </span>
            ) : (
              <a
                href={explorer}
                target="_blank"
                rel="noreferrer"
                title={data.address}
                className="inline-flex items-center gap-1 font-mono text-xs underline decoration-input underline-offset-2 hover:decoration-foreground"
              >
                {shortHash(data.address)}
                <ArrowSquareOutIcon size={12} aria-hidden="true" />
              </a>
            )}
          </DetailRow>
          <DetailRow label="Payer">
            <span title={data.terms.payer} className="font-mono text-xs">
              {shortHash(data.terms.payer)}
            </span>
          </DetailRow>
          <DetailRow label="Arbiter">
            {data.terms.arbiter === ZERO_ADDRESS ? (
              <span className="text-subtle-foreground">None</span>
            ) : (
              <span title={data.terms.arbiter} className="font-mono text-xs">
                {shortHash(data.terms.arbiter)}
              </span>
            )}
          </DetailRow>
          <DetailRow label="Auto-release">{formatDateTime(data.terms.releaseAfter)}</DetailRow>
        </dl>

        {data.dispute !== null && (
          <div className="flex flex-col gap-3 border-t border-border p-4">
            <div className="flex flex-col gap-1">
              <p className="font-medium text-foreground text-sm">Dispute</p>
              <p className="text-muted-foreground text-xs">
                {data.dispute.status === "open"
                  ? `Answer with your evidence. Undecided by ${formatDateTime(data.terms.resolveBy)}, the buyer is refunded.`
                  : "Decided. The thread is kept as it was."}
              </p>
            </div>
            <DisputeThread
              messages={data.dispute.messages}
              viewer="merchant"
              open={data.dispute.status === "open"}
              pending={postMessage.isPending}
              onSend={(body) => postMessage.mutateAsync(body)}
            />
          </div>
        )}

        {(data.outcome === "held" || error !== undefined) && (
          <div className="flex flex-col gap-2 border-t border-border p-4">
            {error !== undefined && <p className="text-destructive text-sm">{error}</p>}
            {data.outcome === "held" && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-subtle-foreground text-xs">
                  Refunds are sent from your settlement wallet. For a managed Safe, connect its
                  owner wallet.
                </p>
                <Button variant="secondary" disabled={busy} onClick={() => void refund()}>
                  {busy ? "Refunding…" : "Refund the payer"}
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}

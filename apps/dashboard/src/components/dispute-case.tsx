/**
 * One dispute, for the arbiter (#313): the thread on the left, the escrow and
 * the decision on the right.
 *
 * The decision is a transaction from the arbiter's own wallet to the escrow
 * factory — `release` to the merchant or `refund` to the buyer. The dashboard
 * signs nothing; it builds nothing either, since the payment API already hands
 * back the calldata for each action. After the receipt the case is read again,
 * which is when the payment API sees the funds moved and closes the case file.
 */

import { chainLabel, shortHash } from "@mayarin/chain";
import { useEffect, useState } from "react";
import { match } from "ts-pattern";
import { DetailRow } from "@/components/detail-row";
import { DisputeThread } from "@/components/dispute-thread";
import { deadlineTone } from "@/components/disputes-queue";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageLoader } from "@/components/ui/page-loader";
import { QueryError } from "@/components/ui/query-error";
import { SectionHeader } from "@/components/ui/section-header";
import { useArbiterMessage, useDisputeCase } from "@/hooks/disputes";
import { ApiError } from "@/lib/api/client";
import { disputesApi } from "@/lib/api/disputes";
import { formatDateTime } from "@/lib/date";
import { runEffect } from "@/lib/run";
import {
  discoverWallets,
  type InjectedWallet,
  requestSpecificAccount,
  sendTransaction,
  switchChain,
  waitForReceipt,
  walletErrorMessage,
} from "@/lib/wallet";
import { withQuery } from "@/lib/with-query";
import type { DisputeCaseDto } from "@/types/payment";

function DisputeCase({ id }: { readonly id: string }) {
  const found = useDisputeCase(id);
  const postMessage = useArbiterMessage(id);
  const [deciding, setDeciding] = useState<"release" | "refund" | "split" | undefined>();
  /** The merchant's share of a split, in percent (#315). */
  const [payeePercent, setPayeePercent] = useState("50");
  // Several extensions can be installed at once (MetaMask, Phantom, …); the
  // arbiter key lives in one of them, so the arbiter picks — MetaMask first.
  const [wallets, setWallets] = useState<readonly InjectedWallet[]>([]);
  const [walletName, setWalletName] = useState<string | undefined>();

  useEffect(() => {
    let live = true;
    void discoverWallets().then((found) => {
      if (!live) return;
      setWallets(found);
      setWalletName((found.find((w) => /metamask/i.test(w.name)) ?? found[0])?.name);
    });
    return () => {
      live = false;
    };
  }, []);
  const [error, setError] = useState<string | undefined>();

  async function decide(data: DisputeCaseDto, action: "release" | "refund" | "split") {
    setDeciding(action);
    setError(undefined);
    try {
      const call =
        action === "split"
          ? await runEffect(disputesApi.resolveCall(id, Math.round(Number(payeePercent) * 100)))
          : { to: data.escrow.factory, data: data.escrow.calls[action] };
      const wallet = wallets.find((w) => w.name === walletName);
      if (wallet === undefined) throw new Error("No browser wallet found");
      // The factory accepts the decision only from the arbiter.
      const account = await requestSpecificAccount(wallet.provider, data.escrow.terms.arbiter);
      await switchChain(wallet.provider, BigInt(data.escrow.chainId));
      const hash = await sendTransaction(wallet.provider, { from: account, ...call });
      await waitForReceipt(wallet.provider, hash);
      await found.refetch();
    } catch (cause) {
      setError(
        walletErrorMessage(cause) ?? (cause instanceof Error ? cause.message : String(cause)),
      );
    } finally {
      setDeciding(undefined);
    }
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
      const splitValid = /^\d{1,3}$/.test(payeePercent) && Number(payeePercent) <= 100;
      const open = dispute.status === "open" && escrow.outcome === "held";
      return (
        <>
          <PageHeader
            title={`Dispute #${dispute.reference}`}
            description="Read both sides, then decide from the arbiter wallet."
          />
          <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-4">
            <section className="flex flex-col gap-3">
              <SectionHeader title="Evidence" />
              <Card>
                <DisputeThread
                  messages={data.messages}
                  viewer="arbiter"
                  open={open}
                  pending={postMessage.isPending}
                  onSend={(body) => postMessage.mutateAsync(body)}
                />
              </Card>
            </section>

            <section className="flex flex-col gap-3">
              <SectionHeader title="Decision" />
              <Card className="gap-0 p-0">
                <div className="flex items-start justify-between gap-3 border-b border-border p-4">
                  <div className="flex flex-col gap-1">
                    <p className="font-medium text-foreground text-sm">
                      {open
                        ? "Waiting for your decision"
                        : escrow.outcome === "released"
                          ? "Released to the merchant"
                          : escrow.outcome === "split"
                            ? "Split between both sides"
                            : "Refunded to the buyer"}
                    </p>
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
                    <span className="font-mono text-xs">{dispute.paymentIntentId}</span>
                  </DetailRow>
                  <DetailRow label="Network">{chainLabel(dispute.chain)}</DetailRow>
                  <DetailRow label="Buyer">
                    <span title={dispute.payer} className="font-mono text-xs">
                      {shortHash(dispute.payer)}
                    </span>
                  </DetailRow>
                  <DetailRow label="Merchant">
                    <span title={dispute.payee} className="font-mono text-xs">
                      {shortHash(dispute.payee)}
                    </span>
                  </DetailRow>
                  <DetailRow label="Opened">{formatDateTime(dispute.openedAt)}</DetailRow>
                </dl>
                {open && (
                  <div className="flex flex-col gap-2 border-t border-border p-4">
                    {wallets.length > 1 && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Sign with</span>
                        {wallets.map((wallet) => (
                          <Button
                            key={wallet.name}
                            size="sm"
                            variant={wallet.name === walletName ? "default" : "secondary"}
                            aria-pressed={wallet.name === walletName}
                            onClick={() => setWalletName(wallet.name)}
                          >
                            {wallet.icon !== undefined && (
                              <img src={wallet.icon} alt="" className="size-4 rounded-sm" />
                            )}
                            {wallet.name}
                          </Button>
                        ))}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        disabled={deciding !== undefined}
                        onClick={() => void decide(data, "release")}
                      >
                        {deciding === "release" ? "Releasing…" : "Release to merchant"}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={deciding !== undefined}
                        onClick={() => void decide(data, "refund")}
                      >
                        {deciding === "refund" ? "Refunding…" : "Refund buyer"}
                      </Button>
                    </div>
                    {escrow.bond !== null && (
                      <div className="flex flex-col gap-1 mt-3">
                        <label className="text-muted-foreground text-xs" htmlFor="split-share">
                          Or split — merchant's share (%)
                        </label>
                        <div className="flex items-stretch gap-2">
                          <Input
                            id="split-share"
                            inputMode="numeric"
                            value={payeePercent}
                            onChange={(event) => setPayeePercent(event.target.value)}
                            aria-invalid={!splitValid}
                            className="flex-1"
                          />
                          <Button
                            variant="secondary"
                            className="h-auto"
                            disabled={deciding !== undefined || !splitValid}
                            onClick={() => void decide(data, "split")}
                          >
                            {deciding === "split" ? "Splitting…" : "Split"}
                          </Button>
                        </div>
                      </div>
                    )}
                    <p className="text-subtle-foreground text-xs">
                      Sent from the arbiter wallet {shortHash(escrow.terms.arbiter)}. Final: the
                      escrow moves its whole balance once.
                    </p>
                    {error !== undefined && <p className="text-destructive text-sm">{error}</p>}
                  </div>
                )}
              </Card>
            </section>
          </div>
        </>
      );
    })
    .exhaustive();
}

export default withQuery(DisputeCase);

/**
 * The hold on an escrowed payment (#304), on the payment detail.
 *
 * Where the funds are, read from the chain through the API, and the one move
 * the merchant has: refund the payer. Release is the payer's (or the clock's),
 * so it is not offered here. Mayarin signs nothing — the merchant's own wallet
 * sends the refund, and the factory accepts it only from the payee.
 */

import { addressExplorerUrl } from "@mayarin/chain";
import { Effect } from "effect";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const data = escrow.data?.escrow;
  if (data == null) return null;

  const headline =
    data.outcome === "released"
      ? "Released to you"
      : data.outcome === "refunded"
        ? "Refunded to the payer"
        : data.disputed
          ? "Held — disputed by the payer"
          : "Held in escrow";
  const tone = data.outcome === "held" ? (data.disputed ? "warning" : "brand") : "success";
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
      <Card className="flex flex-col gap-4 p-5">
        <Badge variant={tone}>{headline}</Badge>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Escrow address</dt>
          <dd className="truncate font-mono">
            {explorer === undefined ? (
              data.address
            ) : (
              <a
                href={explorer}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-2 hover:underline"
              >
                {data.address}
              </a>
            )}
          </dd>
          <dt className="text-muted-foreground">Auto-release</dt>
          <dd>{formatDateTime(data.terms.releaseAfter)}</dd>
          <dt className="text-muted-foreground">Payer</dt>
          <dd className="truncate font-mono">{data.terms.payer}</dd>
          <dt className="text-muted-foreground">Arbiter</dt>
          <dd className="truncate font-mono">
            {data.terms.arbiter === ZERO_ADDRESS ? "None" : data.terms.arbiter}
          </dd>
        </dl>
        {data.outcome === "held" && (
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              className="w-fit"
              disabled={busy}
              onClick={() => void refund()}
            >
              {busy ? "Refunding…" : "Refund the payer"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Sent from your settlement wallet. For a managed Safe, connect its owner wallet.
            </p>
          </div>
        )}
        {error !== undefined && <p className="text-sm text-destructive">{error}</p>}
      </Card>
    </section>
  );
}

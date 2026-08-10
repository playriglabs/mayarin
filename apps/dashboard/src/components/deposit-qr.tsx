/**
 * The QR a payer actually scans (#15).
 *
 * This encodes an **EIP-681 payment URI**, not a web address. Scanning it with
 * a crypto wallet opens a transfer, prefilled with the address, the chain and
 * the exact amount — it does not open a browser. That distinction is the whole
 * point of this component: a link's `url` is a hosted checkout page, which is
 * the right thing to send to someone in a chat and the wrong thing to hold up
 * at a counter.
 *
 * The address is per payment, not per link. It is allocated when the price is
 * locked, and every sale gets its own — which is what lets the watcher tell one
 * payer's transfer from another's. So this renders for a payment, and a link
 * shows it only after a sale has been started from it.
 *
 * Everything needed to pay by hand is on screen beside the code: the full
 * address, the exact amount, and the chain. A payer whose wallet cannot scan
 * must still be able to pay, and a payer who sends the wrong amount or the
 * right amount on the wrong chain is a support ticket at best.
 */

import { CheckIcon, CopyIcon, QrCodeIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { match } from "ts-pattern";
import { AssetAmount } from "@/components/asset-logo";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/ui/query-error";
import { DepositQrSkeleton } from "@/components/ui/skeleton";
import { useDeposit } from "@/hooks/payments";
import { ApiError } from "@/lib/api/client";
import { ICON_NAV } from "@/lib/icons";
import type { DepositDto } from "@/types/payment";

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Could not load the payment address";
}

export interface DepositQrProps {
  readonly paymentIntentId: string;
}

export function DepositQr({ paymentIntentId }: DepositQrProps) {
  const deposit = useDeposit(paymentIntentId);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);

  async function copy(value: string, what: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 2_000);
    } catch {
      setCopyFailed(true);
    }
  }

  return match(deposit)
    .with({ isPending: true }, () => (
      <div role="status" aria-live="polite">
        <span className="sr-only">Loading payment code</span>
        <DepositQrSkeleton />
      </div>
    ))
    .with({ isError: true }, ({ error }) => (
      <QueryError
        message={reasonOf(error)}
        retry={() => void deposit.refetch()}
        retrying={deposit.isFetching}
      />
    ))
    .otherwise(() => {
      const value = deposit.data?.deposit;
      const qrUrl = deposit.data?.qrUrl ?? null;
      if (value === undefined || value === null) {
        return (
          <Alert role="status">
            This payment has no address to scan. It is either still being priced, or it takes the
            on-chain contract path — where the payer signs a transaction in their own wallet rather
            than sending a transfer.
          </Alert>
        );
      }
      return (
        <Paid deposit={value} qrUrl={qrUrl} copied={copied} onCopy={copy}>
          {copyFailed && (
            <Alert role="status">
              Could not reach the clipboard — the address is shown in full above.
            </Alert>
          )}
        </Paid>
      );
    });
}

interface PaidProps {
  readonly deposit: DepositDto;
  /** The rendered code, assembled server-side. `null` when there is none. */
  readonly qrUrl: string | null;
  readonly copied: string | null;
  readonly onCopy: (value: string, what: string) => Promise<void>;
  readonly children?: React.ReactNode;
}

function Paid({ deposit, qrUrl, copied, onCopy, children }: PaidProps) {
  const funded = BigInt(deposit.received.amount) >= BigInt(deposit.amount.amount);

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="grid gap-5 md:grid-cols-[13rem_minmax(0,1fr)] md:items-center md:gap-6">
        <div className="flex flex-col items-center gap-3">
          {qrUrl === null ? (
            <Alert role="status">
              {deposit.asset} names nothing transferable on {deposit.chain}, so there is no code to
              scan. Send the exact amount to the address shown here.
            </Alert>
          ) : (
            <>
              {/* White plate under the code: a QR is read by contrast, and a
                  dark theme behind a dark-module code is unreadable. */}
              <img
                src={qrUrl}
                alt={`Payment code for ${deposit.amount.display} to ${deposit.address}`}
                className="size-48 bg-white p-2 md:size-52"
              />
              <p className="flex items-center gap-2 text-center text-xs text-muted-foreground">
                <QrCodeIcon size={16} aria-hidden="true" />
                Scan with any crypto wallet
              </p>
            </>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-subtle-foreground">Send exactly</dt>
              <dd className="text-2xl font-medium text-foreground">
                <AssetAmount
                  asset={deposit.amount.asset}
                  display={deposit.amount.display}
                  size={24}
                />
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-subtle-foreground">Network</dt>
              <dd>
                <Badge>{deposit.chain}</Badge>
              </dd>
            </div>
          </dl>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-subtle-foreground">Payment address</span>
            {/* Never truncated in the DOM: an address a merchant cannot copy
                whole is worse than one they have to scroll. */}
            <div className="flex items-center gap-2 border border-border bg-muted px-3 py-2">
              <span className="min-w-0 flex-1 break-all font-mono text-sm">{deposit.address}</span>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => void onCopy(deposit.address, "address")}
                aria-label="Copy the payment address"
              >
                {copied === "address" ? (
                  <CheckIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                ) : (
                  <CopyIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                )}
              </Button>
            </div>
          </div>

          <div
            aria-live="polite"
            className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm"
          >
            <Badge variant={funded ? "success" : "warning"}>
              {funded ? "Received" : "Waiting for payment"}
            </Badge>
            <span className={funded ? "text-success" : "text-muted-foreground"}>
              {funded
                ? "Received in full. The payment is clearing."
                : `${deposit.received.display} received · ${deposit.required} confirmation${deposit.required === 1 ? "" : "s"} required`}
            </span>
          </div>
        </div>
      </div>

      {/* One address per sale, so a second payer must not be sent here. */}
      <p className="border-t border-border pt-3 text-center text-xs text-subtle-foreground md:text-left">
        This address belongs to this sale only. Start a new one for the next customer.
      </p>

      {children}
    </div>
  );
}

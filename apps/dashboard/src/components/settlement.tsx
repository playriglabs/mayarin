/**
 * Settlement — a React island over the real `/settlements` endpoint (#15).
 *
 * What the merchant was actually paid, per payment. A settlement is not a
 * record of its own: it is what clearing made of a payment — the locked
 * settlement amount, the fee, the net — plus, on the contract path, what the
 * chain then reported.
 *
 * The totals cover COMPLETED settlements only, as one dollar figure: a
 * merchant settles in USDC on one chain, USDG or EURC on another, and a list
 * of per-asset sums is not a number anyone reads. Dollar stablecoins count 1:1;
 * EURC goes through the payment API's fiat rate, and an asset with no rate is
 * named in the hint rather than silently dropped.
 *
 * The destinations are read from the rail catalog, one card per chain family.
 * Settings holds a single address, and an EVM address means nothing on Solana:
 * a merchant paid on both has two destinations, and `rails[].payTo` is the
 * only place that already resolved each chain's — configured, managed or a
 * verified wallet.
 */

import { chainLabel, isSolanaChainId } from "@mayarin/chain";
import { BankIcon, CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { match } from "ts-pattern";
import { AssetAmount, AssetLogo } from "@/components/asset-logo";
import { ChainLabel, ChainStack } from "@/components/chain-logo";
import { TransactionLink } from "@/components/transaction-link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { CursorPagination } from "@/components/ui/cursor-pagination";
import {
  Empty,
  EmptyAction,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCursorPagination } from "@/hooks/cursor-pagination";
import { useMerchantRails } from "@/hooks/settings";
import { useSettlements } from "@/hooks/settlements";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD } from "@/lib/icons";
import { PAGE_SIZE } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import { withQuery } from "@/lib/with-query";
import type { MerchantRailsResponse } from "@/types/settings";
import type { SettlementDto } from "@/types/settlement";

function toneOf(state: string): "success" | "destructive" | "warning" {
  if (state === "SUCCESS" || state === "SETTLED") return "success";
  return state === "FAILED" ? "destructive" : "warning";
}

const DOT = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
} as const;

/** `PAYMENT_PENDING` → `Payment pending`. */
function stateLabel(state: string): string {
  const words = state.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load settlements";
}

function railsReasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load settlement addresses";
}

/**
 * The network a settlement ran on.
 *
 * The settlement log's chain when the indexer saw one, the payer's rail
 * otherwise. Reading only the log left every deposit-match payment blank: that
 * path settles through the adapter and emits no `PaymentCompleted` to index,
 * so there is no log — but the payment plainly still ran on a network. Neither
 * present is a payment that never chose a rail, and stays a dash.
 */
function NetworkCell({ row }: { readonly row: SettlementDto }) {
  const network = row.chain?.chain ?? row.payment?.chain ?? null;
  if (network === null) return <span className="text-subtle-foreground">—</span>;
  return <ChainLabel chain={network} size={18} className="text-sm" />;
}

const FIGURE =
  "text-[36px] leading-[44px] font-medium tracking-[-0.02em] text-foreground tabular-nums";

/** A borderless tinted surface: label and action on top, figure, then a muted footer. */
function Well({
  label,
  action,
  children,
  footer,
  className,
}: {
  readonly label: string;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly footer?: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-4 rounded-2xl bg-muted p-6", className)}>
      <header className="flex min-h-7 items-center justify-between gap-4">
        <h2 className="text-lg font-medium text-muted-foreground">{label}</h2>
        {action}
      </header>
      <div className="min-w-0">{children}</div>
      {footer !== undefined && (
        <div className="mt-auto text-lg text-subtle-foreground">{footer}</div>
      )}
    </section>
  );
}

function WellSkeleton({ count }: { readonly count: number }) {
  return (
    <div
      aria-hidden="true"
      className={cn("grid gap-4", count === 3 ? "md:grid-cols-3" : "md:grid-cols-2")}
    >
      {["first", "second", "third"].slice(0, count).map((cell) => (
        <div key={cell} className="flex flex-col gap-4 rounded-2xl bg-muted p-6">
          <Skeleton className="h-5 w-24 bg-border" />
          <Skeleton className="h-10 w-36 bg-border" />
          <Skeleton className="h-5 w-48 bg-border" />
        </div>
      ))}
    </div>
  );
}

type Family = "evm" | "svm";

const FAMILY_LABEL: Record<Family, string> = { evm: "EVM address", svm: "Solana address" };

/** Where Settings sends the merchant to change each family's destination. */
const FAMILY_MANAGE: Record<Family, string> = { evm: "/settings", svm: "/wallets" };

function familyOf(chain: string): Family {
  return isSolanaChainId(chain) ? "svm" : "evm";
}

interface Destination {
  readonly address: string;
  readonly chains: readonly string[];
}

interface FamilyDestinations {
  readonly family: Family;
  /** Usually one per family; a managed wallet per chain can make it several. */
  readonly destinations: readonly Destination[];
  /** Chains this family offers that have nowhere to settle yet. */
  readonly missing: readonly string[];
  readonly settlesIn: readonly string[];
}

/** One entry per chain family the deployment supports, EVM first. */
function destinationsByFamily(report: MerchantRailsResponse): readonly FamilyDestinations[] {
  const families = [...new Set(report.supported.map((entry) => familyOf(entry.chain)))].sort();

  return families.map((family) => {
    const rails = report.rails.filter((rail) => familyOf(rail.chain) === family);

    const chainsByAddress = new Map<string, Set<string>>();
    for (const rail of rails) {
      if (rail.payTo === null) continue;
      const chains = chainsByAddress.get(rail.payTo) ?? new Set<string>();
      chains.add(rail.chain);
      chainsByAddress.set(rail.payTo, chains);
    }

    const missing = [
      ...new Set(
        report.unavailable
          .filter((entry) => entry.kind === "no-settlement-destination")
          .map((entry) => entry.chain)
          .filter((chain) => familyOf(chain) === family),
      ),
    ];

    return {
      family,
      destinations: [...chainsByAddress].map(([address, chains]) => ({
        address,
        chains: [...chains],
      })),
      missing,
      settlesIn: [...new Set(rails.map((rail) => rail.settlementAsset))],
    };
  });
}

function CopyAddress({ address }: { readonly address: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // The address is on screen in full; copying by hand still works.
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={copied ? "Copied" : "Copy address"}
      className={buttonVariants({ variant: "ghost", size: "icon" })}
    >
      {copied ? (
        <CheckIcon size={14} aria-hidden="true" />
      ) : (
        <CopyIcon size={14} aria-hidden="true" />
      )}
    </button>
  );
}

function SettlesIn({ assets }: { readonly assets: readonly string[] }) {
  // One tooltip per token, so hovering a logo names that asset and nothing
  // else. The list itself stays readable to a screen reader through each label.
  return (
    <TooltipProvider>
      <span className="flex h-5 items-center">
        {assets.map((asset, index) => (
          <Tooltip key={asset}>
            <TooltipTrigger
              render={
                <span
                  role="img"
                  aria-label={asset}
                  className={cn(
                    "inline-flex cursor-default rounded-full transition-transform hover:z-10 hover:-translate-y-0.5",
                    index > 0 && "-ml-1.5",
                  )}
                >
                  <AssetLogo symbol={asset} size={18} className="rounded-[50%] ring-2 ring-muted" />
                </span>
              }
            />
            <TooltipContent>{asset}</TooltipContent>
          </Tooltip>
        ))}
      </span>
    </TooltipProvider>
  );
}

function FamilyWell({ entry }: { readonly entry: FamilyDestinations }) {
  const ready = entry.destinations.length > 0;
  const several = entry.destinations.length > 1;

  return (
    <Well
      label={FAMILY_LABEL[entry.family]}
      action={
        <a
          href={FAMILY_MANAGE[entry.family]}
          className={buttonVariants({ variant: "secondary", size: "sm" })}
        >
          {ready ? "Manage" : "Set up"}
        </a>
      }
      footer={
        <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn("size-1.5 rounded-full", ready ? "bg-success" : "bg-warning")}
            />
            {ready ? "Ready" : "No address"}
          </span>
          {entry.settlesIn.length > 0 && (
            <span className="inline-flex items-center gap-2">
              Settles in <SettlesIn assets={entry.settlesIn} />
            </span>
          )}
          {ready && entry.missing.length > 0 && (
            <span className="text-warning">
              Not set on {entry.missing.length} network{entry.missing.length === 1 ? "" : "s"}
            </span>
          )}
        </span>
      }
    >
      {ready ? (
        <ul className="flex flex-col gap-3">
          {entry.destinations.map((destination) => (
            <li key={destination.address} className="flex min-w-0 flex-col gap-1.5">
              <span className="flex items-start gap-2">
                {/* Never truncated in the DOM: an address a merchant cannot copy
                    whole is worse than one they have to wrap. */}
                <span className="min-w-0 font-mono text-base break-all text-foreground">
                  {destination.address}
                </span>
                <CopyAddress address={destination.address} />
              </span>
              {/* With one address the chain list is noise; with several it is
                  the only thing telling them apart. */}
              {several && <ChainStack chains={destination.chains} size={16} tooltip={chainLabel} />}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-base text-subtle-foreground">
          {entry.family === "svm"
            ? "Connect and verify a Solana wallet to be paid on Solana."
            : "Set a settlement address or provision a managed wallet."}
        </p>
      )}
    </Well>
  );
}

function Settlement() {
  const pagination = useCursorPagination();
  const settlements = useSettlements(PAGE_SIZE, pagination.cursor);
  const rails = useMerchantRails();

  const rows = settlements.data?.settlements ?? [];
  const summary = settlements.data?.summary;
  const totals = summary?.totals ?? [];
  const unpriced = summary?.usd.unpriced ?? [];
  const failed = summary?.failedCount ?? 0;

  return (
    <div className="flex flex-col gap-8">
      {match(settlements)
        .with({ isPending: true }, () => <WellSkeleton count={3} />)
        .with({ isError: true }, ({ error }) => (
          <QueryError
            message={reasonOf(error)}
            retry={() => void settlements.refetch()}
            retrying={settlements.isFetching}
          />
        ))
        .otherwise(() => (
          <div className="grid gap-4 md:grid-cols-3">
            <Well
              label="Settled"
              footer={`Net across ${summary?.settledCount ?? 0} settlement${summary?.settledCount === 1 ? "" : "s"}${totals.length > 0 ? ` in ${totals.map((total) => total.asset).join(", ")}` : ""}.${unpriced.length > 0 ? ` ${unpriced.join(", ")} not counted: no USD rate.` : ""}`}
            >
              <span className={FIGURE}>
                {totals.length === 0 ? "—" : (summary?.usd.netAmount.display ?? "—")}
              </span>
            </Well>
            <Well label="Fees taken" footer="Split at settlement, not held by Mayarin.">
              <span className={FIGURE}>
                {totals.length === 0 ? "—" : (summary?.usd.fee.display ?? "—")}
              </span>
            </Well>
            <Well
              label="In flight"
              footer={
                failed === 0 ? (
                  "Priced and on the way. Nothing failed."
                ) : (
                  <span className="text-destructive">{failed} failed, needs attention.</span>
                )
              }
            >
              <span className={FIGURE}>{summary?.inFlightCount ?? 0}</span>
            </Well>
          </div>
        ))}

      {match(rails)
        .with({ isPending: true }, () => <WellSkeleton count={2} />)
        .with({ isError: true }, ({ error }) => (
          <QueryError
            message={railsReasonOf(error)}
            retry={() => void rails.refetch()}
            retrying={rails.isFetching}
          />
        ))
        .otherwise(({ data }) => {
          const families = data === undefined ? [] : destinationsByFamily(data);
          return (
            <div className={cn("grid gap-4", families.length > 1 && "md:grid-cols-2")}>
              {families.map((entry) => (
                <FamilyWell key={entry.family} entry={entry} />
              ))}
            </div>
          );
        })}

      {match(settlements)
        .with({ isPending: true }, () => <TableSkeleton rows={PAGE_SIZE} />)
        .with({ isError: true }, () => null)
        .otherwise(() =>
          rows.length === 0 ? (
            <Empty>
              <EmptyMedia>
                <BankIcon size={ICON_CARD} aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No settlements yet.</EmptyTitle>
              <EmptyDescription>
                Completed payments will settle to the addresses above.
              </EmptyDescription>
              <EmptyAction>
                <a href="/links" className={buttonVariants()}>
                  Take your first payment
                </a>
              </EmptyAction>
            </Empty>
          ) : (
            <div className="flex flex-col gap-3">
              <Table>
                <TableCaption>Settlements to this merchant</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payment</TableHead>
                    <TableHead>Status</TableHead>
                    {/* Beside the reference rather than beside the state: the
                        network and the transaction that settled on it are one
                        fact, and a reference means little without knowing which
                        explorer it belongs to. */}
                    <TableHead>Network</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Fee</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead className="text-right">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.clearingTransactionId} className="hover:bg-muted">
                      <TableCell>
                        <a
                          href={`/payments/${encodeURIComponent(row.paymentIntentId)}`}
                          className="font-mono text-xs text-foreground underline decoration-input underline-offset-2 hover:decoration-foreground"
                        >
                          {row.paymentIntentId}
                        </a>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
                            <span
                              aria-hidden="true"
                              className={cn("size-1.5 rounded-full", DOT[toneOf(row.state)])}
                            />
                            {stateLabel(row.state)}
                          </span>
                          {/* A settlement acted on and then reorged away is the
                              one case that needs a human. */}
                          {row.chain !== null && row.chain.orphanedAt !== null && (
                            <Badge variant="destructive">Reorged</Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <NetworkCell row={row} />
                      </TableCell>
                      <TableCell>
                        {row.reference === null ? (
                          <span className="text-xs text-subtle-foreground">Not settled</span>
                        ) : (
                          <TransactionLink
                            chain={row.chain?.chain ?? row.payment?.chain ?? ""}
                            transactionHash={row.reference}
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {row.fee === null ? (
                          "—"
                        ) : (
                          <AssetAmount asset={row.fee.asset} display={row.fee.display} />
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.netAmount === null ? (
                          "—"
                        ) : (
                          <AssetAmount
                            asset={row.netAmount.asset}
                            display={row.netAmount.display}
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        <time dateTime={isoAttr(row.updatedAt)}>
                          {formatDateTime(row.updatedAt)}
                        </time>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <CursorPagination
                label="Settlement pages"
                page={pagination.page}
                canPrevious={pagination.canPrevious}
                nextCursor={settlements.data?.nextCursor}
                busy={settlements.isFetching}
                onPrevious={pagination.previous}
                onNext={pagination.next}
              />
            </div>
          ),
        )}
    </div>
  );
}

export default withQuery(Settlement);

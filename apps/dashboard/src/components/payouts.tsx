/**
 * Batch payouts — a React island over `/payouts` (#295).
 *
 * Upload or paste `address,amount,asset[,note]`, review what it adds up to,
 * then pay every row in one transaction, from either source:
 *
 * - **Connected wallet** — any wallet, from its own balance: an approval per
 *   token where the allowance is short, then one `PayoutBatcher` call.
 * - **Managed wallet** — the Safe Mayarin settles into; only its owner key can
 *   submit the batch.
 *
 * Mayarin signs neither; it prepares the calldata and afterwards reads the
 * chain back to record what moved.
 */

import { chainLabel, evmChainIdOf, isChainId, shortHash } from "@mayarin/chain";
import { PaperPlaneTiltIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { type ChangeEvent, useEffect, useState } from "react";
import { match } from "ts-pattern";
import { AssetAmount } from "@/components/asset-logo";
import { ChainLabel } from "@/components/chain-logo";
import { TransactionLink } from "@/components/transaction-link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CursorPagination } from "@/components/ui/cursor-pagination";
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { TableError } from "@/components/ui/query-error";
import { SectionHeader } from "@/components/ui/section-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableSkeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useCursorPagination } from "@/hooks/cursor-pagination";
import { usePayoutHistory, usePreparePayout, useRecordPayout } from "@/hooks/payouts";
import { useWallets } from "@/hooks/settings";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD } from "@/lib/icons";
import { PAGE_SIZE } from "@/lib/pagination";
import {
  discoverWallets,
  type InjectedWallet,
  readAllowance,
  requestAccount,
  sendTransaction,
  switchChain,
  waitForReceipt,
  walletErrorMessage,
} from "@/lib/wallet";
import { withQuery } from "@/lib/with-query";
import type { PayoutSource, PreparePayoutResponse } from "@/types/payouts";

const EXAMPLE = "address,amount,asset,note\n0x…,25.00,USDC,September invoice";

const SOURCE_OPTIONS: readonly { value: PayoutSource; label: string }[] = [
  { value: "wallet", label: "Connected wallet" },
  { value: "safe", label: "Managed wallet" },
];

/** How long to keep asking the chain for a receipt that has not landed yet. */
const RECORD_ATTEMPTS = 20;
const RECORD_INTERVAL_MS = 3_000;

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function Payouts() {
  const wallets = useWallets();
  const prepare = usePreparePayout();
  const record = useRecordPayout();
  const [source, setSource] = useState<PayoutSource>("wallet");
  const [chain, setChain] = useState<string | undefined>(undefined);
  const [csv, setCsv] = useState("");
  const [prepared, setPrepared] = useState<PreparePayoutResponse | undefined>(undefined);
  const [injected, setInjected] = useState<readonly InjectedWallet[]>([]);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);

  // A Safe pays only on a network where a verified managed wallet exists; a
  // connected wallet can pay on any network this deployment runs.
  const safes = (wallets.data?.wallets ?? []).filter(
    (wallet) => wallet.provenance === "provisioned" && wallet.verified,
  );
  const networks =
    source === "safe" ? safes.map((safe) => safe.chain) : (wallets.data?.chains ?? []);
  const selected = chain !== undefined && networks.includes(chain) ? chain : networks[0];

  useEffect(() => {
    let live = true;
    void discoverWallets().then((found) => {
      if (live) setInjected(found);
    });
    return () => {
      live = false;
    };
  }, []);

  function reset() {
    setPrepared(undefined);
    setStatus(undefined);
    setError(undefined);
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    setCsv(await file.text());
    reset();
  }

  async function review() {
    if (selected === undefined) return;
    reset();
    try {
      setPrepared(await prepare.mutateAsync({ chain: selected, source, csv }));
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  /** Signs with the merchant's wallet, then records once the chain has it. */
  async function pay(wallet: InjectedWallet) {
    const transaction = prepared?.transaction;
    if (selected === undefined || !isChainId(selected) || transaction == null) return;
    setSending(true);
    setError(undefined);
    try {
      const account = await requestAccount(wallet.provider);
      if (transaction.from !== undefined && account !== transaction.from) {
        throw new Error(`Switch to the owner wallet ${shortHash(transaction.from)} to pay.`);
      }
      await switchChain(wallet.provider, evmChainIdOf(selected));

      // A wallet batch spends through the batcher: approve each token whose
      // allowance falls short, and wait for it, before the payout is sent.
      for (const approval of prepared?.approvals ?? []) {
        const allowance = await readAllowance(
          wallet.provider,
          approval.token,
          account,
          transaction.to,
        );
        if (allowance >= BigInt(approval.amount)) continue;
        setStatus(`Approve ${approval.asset} in your wallet…`);
        const approvalHash = await sendTransaction(wallet.provider, {
          from: account,
          to: approval.token,
          data: approval.data,
        });
        setStatus(`Waiting for the ${approval.asset} approval to confirm…`);
        await waitForReceipt(wallet.provider, approvalHash);
      }

      setStatus("Confirm the payout in your wallet…");
      const transactionHash = await sendTransaction(wallet.provider, {
        from: account,
        to: transaction.to,
        data: transaction.data,
      });

      setStatus("Submitted. Waiting for the chain to confirm every transfer…");
      for (let attempt = 1; attempt <= RECORD_ATTEMPTS; attempt += 1) {
        try {
          await record.mutateAsync({ chain: selected, source, csv, transactionHash });
          setStatus(undefined);
          setPrepared(undefined);
          setCsv("");
          return;
        } catch (cause) {
          // 404 is "not mined yet"; anything else is an answer.
          const pending = cause instanceof ApiError && cause.status === 404;
          if (!pending || attempt === RECORD_ATTEMPTS) throw cause;
          await sleep(RECORD_INTERVAL_MS);
        }
      }
    } catch (cause) {
      setStatus(undefined);
      setError(cause instanceof ApiError ? cause.message : walletErrorMessage(cause));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <SectionHeader title="New batch" />
        <Card className="gap-5">
          <div className="flex flex-wrap items-end gap-3">
            <Field className="w-full sm:w-52">
              <FieldLabel htmlFor="payout-source">Pay from</FieldLabel>
              <Select
                items={SOURCE_OPTIONS}
                value={source}
                onValueChange={(value) => {
                  setSource(value as PayoutSource);
                  reset();
                }}
              >
                <SelectTrigger id="payout-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field className="w-full sm:w-52">
              <FieldLabel htmlFor="payout-chain">Network</FieldLabel>
              <Select
                items={networks.map((network) => ({ value: network, label: chainLabel(network) }))}
                value={selected ?? ""}
                onValueChange={(value) => {
                  setChain(value);
                  reset();
                }}
              >
                <SelectTrigger id="payout-chain" disabled={networks.length === 0}>
                  <SelectValue placeholder="Network" />
                </SelectTrigger>
                <SelectContent>
                  {networks.map((network) => (
                    <SelectItem key={network} value={network}>
                      {chainLabel(network)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-input bg-card px-4 text-sm transition-colors duration-150 hover:bg-muted">
              <UploadSimpleIcon size={14} aria-hidden="true" />
              Upload CSV
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} />
            </label>
          </div>

          {source === "safe" && wallets.status === "success" && safes.length === 0 && (
            <Alert>
              You have no verified managed wallet. Create one on the Wallets page, or pay from a
              connected wallet.
            </Alert>
          )}

          <Field>
            <FieldLabel htmlFor="payout-csv">Recipients</FieldLabel>
            <Textarea
              id="payout-csv"
              rows={7}
              value={csv}
              placeholder={EXAMPLE}
              className="font-mono text-xs"
              onChange={(event) => {
                setCsv(event.target.value);
                reset();
              }}
            />
            <FieldDescription>
              One recipient per line: address, amount, asset, and an optional note. Up to 100 rows,
              paid in one transaction.
            </FieldDescription>
          </Field>

          <div>
            <Button
              variant="secondary"
              disabled={csv.trim() === "" || selected === undefined || prepare.isPending}
              onClick={() => void review()}
            >
              Review batch
            </Button>
          </div>

          {prepared !== undefined && <Review prepared={prepared} />}

          {prepared?.transaction != null && (
            <div className="flex flex-wrap items-center gap-2">
              {injected.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No browser wallet found. Install one to pay.
                </p>
              ) : (
                injected.map((wallet) => (
                  <Button key={wallet.name} disabled={sending} onClick={() => void pay(wallet)}>
                    <PaperPlaneTiltIcon size={14} aria-hidden="true" />
                    Pay with {wallet.name}
                  </Button>
                ))
              )}
            </div>
          )}

          {status !== undefined && (
            <p role="status" className="text-sm text-muted-foreground">
              {status}
            </p>
          )}
          {error !== undefined && <Alert variant="destructive">{error}</Alert>}
        </Card>
      </section>

      <History />
    </section>
  );
}

function Review({ prepared }: { readonly prepared: PreparePayoutResponse }) {
  return (
    <div className="flex flex-col gap-3">
      {prepared.errors.length > 0 && (
        <Alert variant="destructive">
          <ul className="flex flex-col gap-1">
            {prepared.errors.map((error) => (
              <li key={`${error.line}-${error.message}`}>
                Line {error.line}: {error.message}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {prepared.rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Line</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>Note</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {prepared.rows.map((row) => (
              <TableRow key={row.line}>
                <TableCell className="text-muted-foreground">{row.line}</TableCell>
                <TableCell className="font-mono text-xs">{row.to}</TableCell>
                <TableCell>{row.note ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <AssetAmount asset={row.amount.asset} display={row.amount.display} size={16} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {prepared.totals.length > 0 && (
        <p className="text-sm">
          Total{" "}
          {prepared.totals.map((total, index) => (
            <span key={total.asset}>
              {index > 0 && " + "}
              <strong>{total.display}</strong>
            </span>
          ))}{" "}
          to {prepared.rows.length} recipient{prepared.rows.length === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}

function History() {
  const pagination = useCursorPagination();
  const history = usePayoutHistory(pagination.cursor);
  const batches = history.data?.batches ?? [];

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="Past batches" />
      {match(history)
        .with({ isPending: true }, () => <TableSkeleton rows={PAGE_SIZE} />)
        .with({ isError: true }, ({ error }) => (
          <TableError
            message={messageOf(error)}
            retry={() => void history.refetch()}
            retrying={history.isFetching}
          />
        ))
        .otherwise(() =>
          // Only the first page can say "no payouts yet": an empty page deeper
          // in is the end of history, where the pager is what a reader needs.
          batches.length === 0 && !pagination.canPrevious ? (
            <Empty>
              <EmptyMedia>
                <PaperPlaneTiltIcon size={ICON_CARD} aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No payouts yet.</EmptyTitle>
              <EmptyDescription>
                Batches the chain confirmed from your managed wallet will appear here.
              </EmptyDescription>
            </Empty>
          ) : (
            <div className="flex flex-col gap-4">
              <Table>
                <TableCaption>Confirmed payout batches, newest first</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Completed</TableHead>
                    <TableHead>Network</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Recipients</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Transaction</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((batch) => (
                    <TableRow key={batch.id}>
                      <TableCell className="text-muted-foreground">
                        <time dateTime={isoAttr(batch.completedAt)}>
                          {formatDateTime(batch.completedAt)}
                        </time>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <ChainLabel chain={batch.chain} size={18} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          {batch.totals.map((total) => (
                            <AssetAmount
                              key={total.asset}
                              asset={total.asset}
                              display={total.display}
                            />
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{batch.rows.length}</TableCell>
                      <TableCell>
                        <Badge variant="success">Confirmed</Badge>
                      </TableCell>
                      <TableCell>
                        <TransactionLink
                          chain={batch.chain}
                          transactionHash={batch.transactionHash}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <CursorPagination
                label="Payout pages"
                page={pagination.page}
                canPrevious={pagination.canPrevious}
                nextCursor={history.data?.nextCursor}
                busy={history.isFetching}
                onPrevious={pagination.previous}
                onNext={pagination.next}
              />
            </div>
          ),
        )}
    </section>
  );
}

export default withQuery(Payouts);

/**
 * Merchant wallets — a React island over `/wallets` (#11).
 *
 * Where the merchant's money can be paid at all. Two ways to have a wallet:
 *
 *   - Connect one you already control. Mayarin records the address and then
 *     asks you to prove it: an address nobody proved control of is an address
 *     that pays a typo.
 *   - Provision a managed smart account. Idempotent — asking twice returns the
 *     same wallet rather than deploying a second one — and the merchant is a
 *     signer on it, which the signer row states rather than asks to be trusted.
 *
 * `verified` is the only field that decides whether an address can be paid, so
 * it is a badge on every row and not a detail behind a click. The proof itself
 * is a signature over a challenge this deployment issued: the merchant signs it
 * in their own wallet and pastes the result, which moves no funds.
 */

import { chainLabel } from "@mayarin/chain";
import { isAssetCode } from "@mayarin/shared/asset";
import {
  ArrowLineUpRightIcon,
  ArrowSquareOutIcon,
  CheckCircleIcon,
  PlusIcon,
  SealCheckIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { match } from "ts-pattern";
import { AssetAmount, AssetLabel } from "@/components/asset-logo";
import { ChainLabel } from "@/components/chain-logo";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyAction,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { QueryError } from "@/components/ui/query-error";
import { SectionHeader } from "@/components/ui/section-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PanelSkeleton, TableSkeleton } from "@/components/ui/skeleton";
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
import {
  useLinkWallet,
  useMerchantRails,
  useProvisionWallet,
  useVerifyWallet,
  useWalletBalance,
  useWalletChallenge,
  useWallets,
  useWalletWithdrawalHistory,
  useWithdraw,
} from "@/hooks/settings";
import { ApiError } from "@/lib/api/client";
import { transactionExplorerUrl } from "@/lib/chain-explorer";
import { formatDateTime, isoAttr } from "@/lib/date";
import { fromEditableDecimalString } from "@/lib/decimal-input";
import { ICON_CARD, ICON_NAV } from "@/lib/icons";
import {
  discoverWallets,
  type InjectedWallet,
  personalSign,
  requestAccount,
  walletErrorMessage,
} from "@/lib/wallet";
import { withQuery } from "@/lib/with-query";
import type { ChainBalanceDto, WalletDto, WalletProvenance } from "@/types/settings";

const PROVENANCE_LABEL: Readonly<Record<WalletProvenance, string>> = {
  linked: "Connected",
  provisioned: "Managed",
  passkey: "Passkey",
};

/** The challenge a merchant is signing, held while they go and sign it. */
interface Ceremony {
  readonly wallet: WalletDto;
  readonly challengeId: string;
  readonly message: string;
}

function WithdrawalAssetOption({
  asset,
  display,
}: {
  readonly asset: string;
  readonly display: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <AssetLabel symbol={asset} size={18} />
      <span aria-hidden="true" className="text-subtle-foreground">
        —
      </span>
      <span className="truncate tabular-nums">{display}</span>
    </span>
  );
}

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load wallets";
}

function withdrawalReasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load withdrawal history";
}

function shortHash(hash: string): string {
  return hash.length <= 20 ? hash : `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

function Wallets() {
  const wallets = useWallets();
  const balance = useWalletBalance();
  const rails = useMerchantRails();
  const withdrawalHistory = useWalletWithdrawalHistory();
  const withdraw = useWithdraw();
  const link = useLinkWallet();
  const provision = useProvisionWallet();
  const challenge = useWalletChallenge();
  const verify = useVerifyWallet();

  const [connecting, setConnecting] = useState(false);
  /** The network an address is being linked on. Wallet records are per chain. */
  const [connectChain, setConnectChain] = useState("");
  const [address, setAddress] = useState("");
  const [ceremony, setCeremony] = useState<Ceremony | null>(null);
  const [signature, setSignature] = useState("");
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  /** Which chain's wallet the open dialog moves from. A merchant has one per chain. */
  const [withdrawChain, setWithdrawChain] = useState("");
  const [withdrawAsset, setWithdrawAsset] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawTo, setWithdrawTo] = useState("");
  const [withdrawFailure, setWithdrawFailure] = useState("");
  /** Every wallet this browser announced. Empty once discovery has finished with none. */
  const [injected, setInjected] = useState<readonly InjectedWallet[]>([]);
  const [signing, setSigning] = useState(false);
  /**
   * Which wallet to talk to, once the merchant has said.
   *
   * Held rather than re-asked, so proving control later in the session does not
   * put the picker back in front of somebody who has already chosen.
   */
  const [chosen, setChosen] = useState<InjectedWallet | null>(null);
  /** The pending action, held while the merchant picks which wallet runs it. */
  const [picking, setPicking] = useState<"connect" | "sign" | null>(null);

  useEffect(() => {
    let live = true;
    void discoverWallets().then((found) => {
      if (!live) return;
      setInjected(found);
      // One wallet is not a choice. Anything more is, and picking for them lands
      // on whichever extension answered fastest — on Brave, its own.
      if (found.length === 1) setChosen(found[0] ?? null);
    });
    return () => {
      live = false;
    };
  }, []);

  /** Runs `action` against the chosen wallet, or asks which one first. */
  function withWallet(action: "connect" | "sign", targetChain?: string) {
    if (action === "connect") {
      const selectedChain = targetChain ?? chain;
      if (selectedChain === undefined) return;
      setConnectChain(selectedChain);
      if (chosen !== null) {
        void connectInjected(chosen, selectedChain);
        return;
      }
      setPicking(action);
      return;
    }

    if (chosen !== null) {
      void signCeremonyWith(chosen);
      return;
    }
    setPicking(action);
  }

  function pick(wallet: InjectedWallet) {
    setChosen(wallet);
    const action = picking;
    setPicking(null);
    if (action === "connect" && connectChain !== "") {
      void connectInjected(wallet, connectChain);
    } else if (action === "sign") {
      void signCeremonyWith(wallet);
    }
  }

  const rows = wallets.data?.wallets ?? [];
  /**
   * The chain this deployment links and provisions on, named by the API rather
   * than assumed here — the browser has no business deciding which network a
   * merchant's money is settled on. Undefined only before the list has loaded,
   * which is also before any of these actions can be reached.
   */
  const chain = wallets.data?.chain;
  /** Every chain this deployment can provision on, named by the API rather than assumed. */
  const provisionChains = wallets.data?.chains ?? [];
  const hasVerifiedWalletOn = (targetChain: string) =>
    rows.some(
      (wallet) =>
        wallet.chain === targetChain && wallet.verified && wallet.provenance !== "provisioned",
    );
  /**
   * Whether there is anything left for the three header actions to add.
   *
   * All three exist to put an address on a chain: one from the merchant's own
   * wallet, one typed in, one provisioned by Mayarin. A merchant who already
   * holds both kinds on every network this deployment provisions on has nothing
   * to add, and three buttons offering it are noise on the screen that is
   * meant to show them what they have.
   *
   * Existence, not verification: an address that is present but unproven still
   * needs work, and that work is the row's own "Prove control" — not one of
   * these. Gated on a non-empty chain list so the actions stay visible while
   * the list is still loading, when hiding them would be a guess.
   */
  const everyChainHasBothWallets =
    provisionChains.length > 0 &&
    provisionChains.every(
      (targetChain) =>
        rows.some(
          (wallet) => wallet.chain === targetChain && wallet.provenance !== "provisioned",
        ) &&
        rows.some((wallet) => wallet.chain === targetChain && wallet.provenance === "provisioned"),
    );
  /** One row per chain this deployment settles on, in the API's order (#244). */
  const chainBalances = balance.data?.balances ?? [];
  /** The assets in the open withdraw dialog: the chosen chain's, never another's. */
  const balances = chainBalances.find((row) => row.chain === withdrawChain)?.balances ?? [];
  const withdrawalRows = withdrawalHistory.data?.withdrawals ?? [];
  /**
   * Where a withdrawal may go: the merchant's own verified wallets, and never
   * the managed one — moving money from a Safe to itself is not a withdrawal.
   */
  const destinations = rows.filter(
    (wallet) => wallet.verified && wallet.provenance !== "provisioned",
  );
  /** The service accepts a destination proved on the source chain only. */
  const withdrawDestinations = destinations.filter((wallet) => wallet.chain === withdrawChain);

  function openConnect(targetChain = chain) {
    if (targetChain === undefined) return;
    setFailure("");
    setNotice("");
    setAddress("");
    setConnectChain(targetChain);
    setConnecting(true);
  }

  function openWithdraw(row: ChainBalanceDto) {
    setWithdrawFailure("");
    setNotice("");
    setWithdrawAmount("");
    setWithdrawChain(row.chain);
    setWithdrawAsset(row.balances[0]?.asset ?? "");
    // A destination has to be on the chain being moved from: the same key
    // controls an EOA everywhere, but the service checks the wallet row, and a
    // wallet row belongs to one chain.
    setWithdrawTo(destinations.find((wallet) => wallet.chain === row.chain)?.address ?? "");
    setWithdrawing(true);
  }

  async function submitWithdrawal() {
    setWithdrawFailure("");
    setNotice("");
    if (!isAssetCode(withdrawAsset)) {
      setWithdrawFailure("Pick an asset to withdraw");
      return;
    }
    // Parsed against the asset's own precision rather than multiplied by a
    // float: eighteen decimals of ETH do not survive a Number.
    let minorUnits: bigint;
    try {
      minorUnits = fromEditableDecimalString(withdrawAmount, withdrawAsset).amount;
    } catch {
      setWithdrawFailure(`That is not a valid ${withdrawAsset} amount`);
      return;
    }

    try {
      const { txHash } = await withdraw.mutateAsync({
        chain: withdrawChain,
        asset: withdrawAsset,
        amount: minorUnits.toString(),
        to: withdrawTo,
      });
      setWithdrawing(false);
      setNotice(`Withdrawal submitted: ${txHash}`);
    } catch (error) {
      setWithdrawFailure(
        error instanceof ApiError ? error.message : "Could not submit that withdrawal",
      );
    }
  }

  /**
   * Connect, prove and verify in one gesture.
   *
   * The whole ceremony is three requests and a signature, and the merchant's
   * wallet can answer all of them — so it does, rather than the merchant
   * carrying a message to a console and a hex string back.
   *
   * An address already on file is not an error here: the merchant asking again
   * is asking to finish, so it picks up whatever step is unfinished instead of
   * refusing with "already claimed".
   */
  async function connectInjected(wallet: InjectedWallet, targetChain: string) {
    if (targetChain === "") return;
    setFailure("");
    setNotice("");
    setSigning(true);
    try {
      const account = await requestAccount(wallet.provider);
      const existing = rows.find((row) => row.chain === targetChain && row.address === account);
      if (existing?.verified === true) {
        setConnecting(false);
        setNotice(`That wallet is already verified on ${chainLabel(targetChain)}.`);
        return;
      }

      const row =
        existing ?? (await link.mutateAsync({ chain: targetChain, address: account })).wallet;
      const issued = await challenge.mutateAsync(row.id);
      const signature = await personalSign(wallet.provider, account, issued.message);
      await verify.mutateAsync({
        walletId: row.id,
        challengeId: issued.challengeId,
        signature,
      });
      setConnecting(false);
      setNotice(`Wallet verified on ${chainLabel(targetChain)}. It can be paid there.`);
    } catch (error) {
      const reason = error instanceof ApiError ? error.message : walletErrorMessage(error);
      // `undefined` is the merchant closing their wallet's prompt, which is a
      // decision rather than a failure.
      if (reason !== undefined) setFailure(reason);
    } finally {
      setSigning(false);
    }
  }

  /**
   * Signs an outstanding challenge with the browser's wallet.
   *
   * Refuses when the selected account is not the wallet being proved: signing
   * would succeed and the recovery would name a different address, which
   * surfaces as "that signature did not verify" and sends the merchant looking
   * in the wrong place.
   */
  async function signCeremonyWith(wallet: InjectedWallet) {
    const active = ceremony;
    if (active === null) return;
    setFailure("");
    setNotice("");
    setSigning(true);
    try {
      const account = await requestAccount(wallet.provider);
      if (account !== active.wallet.address) {
        setFailure(`Switch ${wallet.name} to ${active.wallet.address} and try again.`);
        return;
      }
      const signed = await personalSign(wallet.provider, account, active.message);
      await verify.mutateAsync({
        walletId: active.wallet.id,
        challengeId: active.challengeId,
        signature: signed,
      });
      setCeremony(null);
      setNotice("Wallet verified. It can be paid.");
    } catch (error) {
      const reason = error instanceof ApiError ? error.message : walletErrorMessage(error);
      if (reason !== undefined) setFailure(reason);
    } finally {
      setSigning(false);
    }
  }

  async function connect() {
    if (connectChain === "") return;
    setFailure("");
    setNotice("");
    try {
      const { wallet } = await link.mutateAsync({ chain: connectChain, address: address.trim() });
      setConnecting(false);
      setAddress("");
      // Straight into the proof: an unverified wallet cannot be paid, so
      // stopping here would leave the merchant one step short of the point.
      await startProof(wallet);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not connect that address");
    }
  }

  /**
   * Provisions a managed wallet on one chain (#244).
   *
   * Named per chain rather than "the" chain, because a merchant who joined when
   * this deployment ran on one network needs a wallet on the next one without
   * anybody running a script for them — and a Safe's address is derived from a
   * salt carrying the chain, so the second wallet is a different address.
   */
  async function provisionOn(target: string) {
    setFailure("");
    setNotice("");
    try {
      await provision.mutateAsync(target);
      setNotice(`Managed wallet ready on ${chainLabel(target)}.`);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not provision a wallet");
    }
  }

  async function startProof(wallet: WalletDto) {
    setFailure("");
    setNotice("");
    setSignature("");
    try {
      const issued = await challenge.mutateAsync(wallet.id);
      setCeremony({ wallet, challengeId: issued.challengeId, message: issued.message });
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not issue a challenge");
    }
  }

  async function submitProof() {
    if (ceremony === null) return;
    setFailure("");
    setNotice("");
    try {
      await verify.mutateAsync({
        walletId: ceremony.wallet.id,
        challengeId: ceremony.challengeId,
        signature: signature.trim(),
      });
      setCeremony(null);
      setNotice("Wallet verified. It can be paid.");
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "That signature did not verify");
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs text-subtle-foreground">
          {rows.length} wallet{rows.length === 1 ? "" : "s"}
        </p>
        <span className="flex flex-wrap justify-end gap-2">
          {/* The browser's wallet does the whole ceremony, so it is the primary
              action wherever there is one. The typed-address path stays for a
              wallet that is not in this browser — a hardware signer, a Safe
              app, another machine. All three disappear once every network has
              both kinds of address, because then they add nothing. */}
          {!everyChainHasBothWallets && injected.length > 0 && chain !== undefined && (
            <Button
              variant="secondary"
              onClick={() => withWallet("connect", chain)}
              disabled={signing}
            >
              <WalletIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
              {signing
                ? "Check your wallet…"
                : `Connect ${chosen?.name ?? "wallet"} on ${chainLabel(chain)}`}
            </Button>
          )}
          {!everyChainHasBothWallets && (
            <Button
              variant="secondary"
              onClick={() => openConnect()}
              disabled={chain === undefined}
            >
              <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
              Connect existing
            </Button>
          )}
          {!everyChainHasBothWallets && chain !== undefined && hasVerifiedWalletOn(chain) && (
            <Button onClick={() => void provisionOn(chain)} disabled={provision.isPending}>
              <WalletIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
              Create on {chainLabel(chain)}
            </Button>
          )}
        </span>
      </div>

      {notice !== "" && (
        <Alert role="status" className="flex items-center gap-2">
          <CheckCircleIcon size={ICON_NAV} weight="fill" className="shrink-0 text-success" />
          {notice}
        </Alert>
      )}

      {/* The balance sits above the wallet list because it is the question a
          merchant opens this page with. Read from the chain, not the ledger:
          once settlement lands on-chain the money is theirs, not Mayarin's to
          account for. */}
      {match(balance)
        .with({ isPending: true }, () => <PanelSkeleton lines={3} />)
        .with({ isError: true }, ({ error }) => (
          <QueryError
            message={reasonOf(error)}
            retry={() => void balance.refetch()}
            retrying={balance.isFetching}
          />
        ))
        .otherwise(() => (
          <div className="flex flex-col gap-3">
            <h2 className="font-medium text-sm">Settlement balances</h2>
            {/* One card per chain. A merchant's Safe address is derived per
                chain — the salt carries it — so a merchant paid on two chains
                holds two addresses and two balances (#244). Showing one of them
                made the other chain's money invisible. */}
            <div className="grid gap-3 lg:grid-cols-2">
              {chainBalances.map((row) => {
                const provisionable = provisionChains.includes(row.chain);
                const hasDestination = destinations.some((wallet) => wallet.chain === row.chain);
                const hasVerifiedSigner = hasVerifiedWalletOn(row.chain);
                return (
                  <Card key={row.chain} className="flex flex-col gap-4 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex flex-col gap-1">
                        <h3 className="font-medium text-sm">
                          <ChainLabel chain={row.chain} />
                        </h3>
                        <p className="break-all font-mono text-subtle-foreground text-sm">
                          {row.address ?? "No settlement address on this network yet"}
                        </p>
                      </div>
                      <span className="flex flex-wrap gap-2">
                        {row.address === null && (
                          <Button variant="secondary" onClick={() => openConnect(row.chain)}>
                            <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                            Connect on {chainLabel(row.chain)}
                          </Button>
                        )}
                        {row.address === null && hasVerifiedSigner && provisionable && (
                          <Button
                            variant="secondary"
                            onClick={() => void provisionOn(row.chain)}
                            disabled={provision.isPending}
                          >
                            <WalletIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                            Create wallet on {chainLabel(row.chain)}
                          </Button>
                        )}
                        {row.withdrawable && (
                          <Button
                            variant="secondary"
                            onClick={() => openWithdraw(row)}
                            disabled={row.balances.length === 0 || !hasDestination}
                          >
                            <ArrowLineUpRightIcon
                              size={ICON_NAV}
                              weight="bold"
                              aria-hidden="true"
                            />
                            Withdraw
                          </Button>
                        )}
                      </span>
                    </div>

                    {row.balances.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        {row.address === null
                          ? "Nothing can be paid to you on this network until you have an address here."
                          : "Nothing here yet."}
                      </p>
                    ) : (
                      <dl className="flex flex-wrap gap-6">
                        {row.balances.map((amount) => (
                          <div key={amount.asset} className="flex flex-col gap-1">
                            <dt className="text-muted-foreground text-xs uppercase">
                              <AssetLabel symbol={amount.asset} size={18} />
                            </dt>
                            <dd className="font-mono text-lg tabular-nums">{amount.display}</dd>
                          </div>
                        ))}
                      </dl>
                    )}

                    {row.address !== null && !row.withdrawable && (
                      <p className="text-muted-foreground text-xs">
                        This address is yours, not one Mayarin provisioned — withdraw from it in
                        your own wallet.
                      </p>
                    )}
                    {row.withdrawable && !hasDestination && (
                      <p className="text-muted-foreground text-xs">
                        Connect and verify an address on {chainLabel(row.chain)} to withdraw to it.
                      </p>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        ))}

      {/* Why a payer is, or is not, offered each network. The reason is the
          part that only exists here: before it, "my Arc link does not work"
          arrived as a payment that refused to lock, naming a settings field the
          merchant had never been shown (#244). */}
      {match(rails)
        .with({ isPending: true }, () => <PanelSkeleton lines={2} />)
        .with({ isError: true }, ({ error }) => (
          <QueryError
            message={reasonOf(error)}
            retry={() => void rails.refetch()}
            retrying={rails.isFetching}
          />
        ))
        .otherwise(({ data }) => {
          const networks = (data?.supported ?? []).map((supported) => ({
            chain: supported.chain,
            rails: data?.rails.filter((rail) => rail.chain === supported.chain) ?? [],
            unavailable: [
              ...new Map(
                (data?.unavailable ?? [])
                  .filter((entry) => entry.chain === supported.chain)
                  .map((entry) => [`${entry.asset ?? "network"}:${entry.reason}`, entry]),
              ).values(),
            ],
          }));

          return (
            <Card className="flex flex-col gap-4 p-4">
              <div className="flex flex-col gap-1">
                <h2 className="font-medium text-sm">Payment availability</h2>
                <p className="text-muted-foreground text-xs">
                  Every network uses the same payment link and settles into{" "}
                  {data?.settlementAsset ?? "your settlement asset"}.
                </p>
              </div>

              {networks.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No payment network is configured for this deployment.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {networks.map((network) => {
                    const hasRails = network.rails.length > 0;
                    const partiallyAvailable = hasRails && network.unavailable.length > 0;
                    return (
                      <section
                        key={network.chain}
                        className="flex min-w-0 flex-col gap-3 border border-border bg-muted/30 p-3"
                        aria-label={`${chainLabel(network.chain)} payment availability`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="font-medium text-sm">
                            <ChainLabel chain={network.chain} />
                          </h3>
                          <Badge variant={hasRails && !partiallyAvailable ? "success" : "warning"}>
                            {partiallyAvailable
                              ? "Partially available"
                              : hasRails
                                ? "Available"
                                : "Needs attention"}
                          </Badge>
                        </div>

                        {hasRails && (
                          <div className="flex flex-wrap gap-3">
                            {network.rails.map((rail) => (
                              <AssetLabel key={rail.asset} symbol={rail.asset} size={18} />
                            ))}
                          </div>
                        )}

                        {!hasRails && network.unavailable.length === 0 ? (
                          <p className="text-muted-foreground text-xs">
                            No payable asset is available on this network.
                          </p>
                        ) : (
                          network.unavailable.length > 0 && (
                            <ul className="flex flex-col gap-2 border-border border-t pt-3 text-muted-foreground text-xs">
                              {network.unavailable.map((entry) => (
                                <li key={`${entry.asset ?? "network"}:${entry.reason}`}>
                                  <span className="font-medium text-foreground">
                                    {entry.asset ?? "Network"}
                                  </span>{" "}
                                  — {entry.reason}
                                </li>
                              ))}
                            </ul>
                          )
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}

      {failure !== "" && ceremony === null && !connecting && (
        <Alert variant="destructive">{failure}</Alert>
      )}

      {match(wallets)
        .with({ isPending: true }, () => <TableSkeleton rows={2} />)
        .with({ isError: true }, ({ error }) => (
          <QueryError
            message={reasonOf(error)}
            retry={() => void wallets.refetch()}
            retrying={wallets.isFetching}
          />
        ))
        .otherwise(() =>
          rows.length === 0 ? (
            <Empty>
              <EmptyMedia>
                <WalletIcon size={ICON_CARD} aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No wallets yet.</EmptyTitle>
              <EmptyDescription>Connect an address you control to continue.</EmptyDescription>
              <EmptyAction className="flex flex-wrap justify-center gap-2">
                <Button variant="secondary" onClick={() => openConnect()}>
                  Connect existing
                </Button>
              </EmptyAction>
            </Empty>
          ) : (
            <Table>
              <TableCaption>Wallets this merchant can be paid at</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Address</TableHead>
                  <TableHead>Chain</TableHead>
                  <TableHead>Origin</TableHead>
                  <TableHead>Control</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((wallet) => (
                  <TableRow key={wallet.id}>
                    {/* Shown whole: an address a merchant cannot copy in full is
                        worse than one they have to scroll. */}
                    <TableCell className="break-all font-mono text-xs">{wallet.address}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <ChainLabel chain={wallet.chain} size={18} />
                    </TableCell>
                    <TableCell>
                      <Badge>{PROVENANCE_LABEL[wallet.provenance]}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={wallet.verified ? "success" : "warning"}>
                        {wallet.verified ? "Verified" : "Unproven"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <time dateTime={isoAttr(wallet.createdAt)}>
                        {formatDateTime(wallet.createdAt)}
                      </time>
                    </TableCell>
                    <TableCell className="text-right">
                      {wallet.verified ? (
                        <CheckCircleIcon
                          size={ICON_NAV}
                          weight="fill"
                          aria-label="Verified"
                          className="ml-auto text-success"
                        />
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => void startProof(wallet)}>
                          <SealCheckIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                          Prove control
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ),
        )}

      <section className="flex flex-col gap-3">
        <SectionHeader title="Withdrawal history" />
        {match(withdrawalHistory)
          .with({ isPending: true }, () => <TableSkeleton rows={3} />)
          .with({ isError: true }, ({ error }) => (
            <QueryError
              message={withdrawalReasonOf(error)}
              retry={() => void withdrawalHistory.refetch()}
              retrying={withdrawalHistory.isFetching}
            />
          ))
          .otherwise(() =>
            withdrawalRows.length === 0 ? (
              <Empty>
                <EmptyMedia>
                  <ArrowLineUpRightIcon size={ICON_CARD} aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>No withdrawals yet.</EmptyTitle>
                <EmptyDescription>
                  Successful withdrawals from your managed wallet will appear here.
                </EmptyDescription>
              </Empty>
            ) : (
              <Table>
                <TableCaption>Recent successful managed-wallet withdrawals</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Completed</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Transaction</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {withdrawalRows.map((row) => {
                    const explorer = transactionExplorerUrl(row.chain, row.transactionHash);
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="text-muted-foreground">
                          <time dateTime={isoAttr(row.completedAt)}>
                            {formatDateTime(row.completedAt)}
                          </time>
                        </TableCell>
                        <TableCell className="text-right">
                          <AssetAmount asset={row.amount.asset} display={row.amount.display} />
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {row.destinationAddress}
                        </TableCell>
                        <TableCell>
                          <Badge variant="success">Confirmed</Badge>
                        </TableCell>
                        <TableCell>
                          {explorer === undefined ? (
                            <span className="font-mono text-muted-foreground text-xs">
                              {shortHash(row.transactionHash)}
                            </span>
                          ) : (
                            <a
                              href={explorer}
                              target="_blank"
                              rel="noreferrer"
                              title={row.transactionHash}
                              className="inline-flex items-center gap-1 font-mono text-foreground text-xs underline decoration-input underline-offset-2 hover:decoration-foreground"
                            >
                              {shortHash(row.transactionHash)}
                              <ArrowSquareOutIcon size={12} aria-hidden="true" />
                            </a>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ),
          )}
      </section>

      {/* Which wallet, asked once. Brave and Phantom and MetaMask all announce,
          and the one that answers first is not the one the merchant uses. */}
      <Dialog open={picking !== null} onOpenChange={(next) => !next && setPicking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose a wallet</DialogTitle>
            <DialogDescription>
              {injected.length} wallets are installed in this browser. Signing grants nothing beyond
              proving this one address
              {picking === "connect" && connectChain !== ""
                ? ` on ${chainLabel(connectChain)}`
                : ""}
              .
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            {injected.map((wallet) => (
              <Button
                key={wallet.name}
                variant="secondary"
                className="justify-start py-4"
                onClick={() => pick(wallet)}
              >
                {wallet.icon === undefined ? (
                  <WalletIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                ) : (
                  // The wallet's own announced icon, a data URI — no network
                  // request, and nothing here can point at a remote image.
                  <img src={wallet.icon} alt="" className="size-4 rounded-sm" />
                )}
                {wallet.name}
              </Button>
            ))}
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={connecting} onOpenChange={(next) => !next && setConnecting(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect an existing wallet</DialogTitle>
            <DialogDescription>
              Register an address you already control. It cannot be paid until you prove control of
              it in the next step.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {failure !== "" && <Alert variant="destructive">{failure}</Alert>}
            {chainBalances.length > 1 && (
              <Field>
                <FieldLabel htmlFor="wallet-chain">Network</FieldLabel>
                <Select
                  items={chainBalances.map((row) => ({
                    value: row.chain,
                    label: chainLabel(row.chain),
                  }))}
                  value={connectChain}
                  onValueChange={setConnectChain}
                >
                  <SelectTrigger id="wallet-chain">
                    <SelectValue
                      placeholder="Select a network"
                      renderValue={(option) => <ChainLabel chain={option.value} />}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {chainBalances.map((row) => (
                      <SelectItem key={row.chain} value={row.chain}>
                        <ChainLabel chain={row.chain} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Link the address on every network where it will receive or withdraw funds.
                </FieldDescription>
              </Field>
            )}
            {injected.length > 0 && connectChain !== "" && (
              <Button
                variant="secondary"
                onClick={() => withWallet("connect", connectChain)}
                disabled={signing}
              >
                <WalletIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                {signing ? "Check your wallet…" : `Use ${chosen?.name ?? "browser wallet"}`}
              </Button>
            )}
            <Field>
              <FieldLabel htmlFor="wallet-address">Address</FieldLabel>
              <Input
                id="wallet-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="0x…"
                className="font-mono text-xs"
              />
              <FieldDescription>
                On {connectChain === "" ? "the selected network" : chainLabel(connectChain)}.
              </FieldDescription>
            </Field>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button
              onClick={connect}
              disabled={connectChain === "" || address.trim() === "" || link.isPending}
            >
              {link.isPending ? "Connecting…" : "Connect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={withdrawing} onOpenChange={(next) => !next && setWithdrawing(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw</DialogTitle>
            <DialogDescription>
              Moves funds out of your managed wallet. It can only go to an address you have already
              proved you control.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {withdrawFailure !== "" && <Alert variant="destructive">{withdrawFailure}</Alert>}

            <Field>
              <FieldLabel htmlFor="withdraw-asset">Asset</FieldLabel>
              <Select
                items={balances.map((amount) => ({
                  value: amount.asset,
                  label: `${amount.asset} — ${amount.display}`,
                }))}
                value={withdrawAsset}
                onValueChange={setWithdrawAsset}
              >
                <SelectTrigger id="withdraw-asset">
                  <SelectValue
                    placeholder="Select an asset"
                    renderValue={(option) => {
                      const amount = balances.find((balance) => balance.asset === option.value);
                      return amount === undefined ? (
                        option.label
                      ) : (
                        <WithdrawalAssetOption asset={amount.asset} display={amount.display} />
                      );
                    }}
                  />
                </SelectTrigger>
                <SelectContent>
                  {balances.map((amount) => (
                    <SelectItem key={amount.asset} value={amount.asset}>
                      <WithdrawalAssetOption asset={amount.asset} display={amount.display} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="withdraw-amount">Amount</FieldLabel>
              <Input
                id="withdraw-amount"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-xs"
              />
              <FieldDescription>
                Use a dot or comma as the decimal separator. Gas is paid in the chain's own
                currency, so a withdrawal costs slightly more than it moves.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="withdraw-to">To</FieldLabel>
              <Select
                items={withdrawDestinations.map((wallet) => ({
                  value: wallet.address,
                  label: wallet.address,
                }))}
                value={withdrawTo}
                onValueChange={setWithdrawTo}
              >
                <SelectTrigger id="withdraw-to">
                  <SelectValue placeholder="Select an address" />
                </SelectTrigger>
                <SelectContent>
                  {withdrawDestinations.map((wallet) => (
                    <SelectItem key={wallet.id} value={wallet.address}>
                      {wallet.address}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>One of your verified wallets.</FieldDescription>
            </Field>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button
              onClick={submitWithdrawal}
              disabled={withdrawAmount.trim() === "" || withdrawTo === "" || withdraw.isPending}
            >
              {withdraw.isPending ? "Withdrawing…" : "Withdraw"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ceremony !== null} onOpenChange={(next) => !next && setCeremony(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Prove control</DialogTitle>
            <DialogDescription>
              Sign this exact message with the wallet, then paste the signature. Signing moves no
              funds and grants nothing beyond this one address.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {failure !== "" && <Alert variant="destructive">{failure}</Alert>}

            {injected.length > 0 && (
              <Button onClick={() => withWallet("sign")} disabled={signing}>
                <WalletIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                {signing ? "Check your wallet…" : `Sign with ${chosen?.name ?? "your wallet"}`}
              </Button>
            )}

            <Field>
              <FieldLabel htmlFor="wallet-message">Message to sign</FieldLabel>
              <Textarea
                id="wallet-message"
                value={ceremony?.message ?? ""}
                readOnly
                rows={4}
                className="font-mono text-xs"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="wallet-signature">
                {injected.length === 0 ? "Signature" : "Signature (or paste one)"}
              </FieldLabel>
              <Textarea
                id="wallet-signature"
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                rows={3}
                placeholder="0x…"
                className="font-mono text-xs"
              />
            </Field>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Later</Button>} />
            <Button onClick={submitProof} disabled={signature.trim() === "" || verify.isPending}>
              {verify.isPending ? "Verifying…" : "Verify"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default withQuery(Wallets);

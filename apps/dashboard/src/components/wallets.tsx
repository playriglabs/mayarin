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
 *     It has one address on every network, set up network by network.
 *
 * A wallet the merchant proved once counts on every network: the key behind an
 * EVM address holds it on every EVM chain, so the page never asks twice.
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
  CheckCircleIcon,
  PlusIcon,
  SealCheckIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { match } from "ts-pattern";
import { AssetAmount, AssetLabel } from "@/components/asset-logo";
import { ChainLabel } from "@/components/chain-logo";
import { TransactionLink } from "@/components/transaction-link";
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
  useProvisionWalletEverywhere,
  useVerifyWallet,
  useWalletBalance,
  useWalletChallenge,
  useWallets,
  useWalletWithdrawalHistory,
  useWithdraw,
} from "@/hooks/settings";
import { ApiError } from "@/lib/api/client";
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

/**
 * One address as the merchant thinks of it: a wallet, on however many networks.
 *
 * The API keeps a record per network, and listing those records made one wallet
 * look like three. Grouped by address and origin, so a connected key and a
 * managed Safe never merge even in the impossible case they shared an address.
 */
interface WalletGroup {
  readonly key: string;
  readonly address: string;
  readonly provenance: WalletProvenance;
  readonly chains: readonly string[];
  /** Merchant-held: proved on any network. Managed: deployed on every network on file. */
  readonly verified: boolean;
  /** The record to prove, when nothing in a merchant-held group has been proved. */
  readonly unproven: WalletDto | undefined;
  readonly createdAt: string;
}

function groupWallets(rows: readonly WalletDto[]): readonly WalletGroup[] {
  const byKey = new Map<string, readonly WalletDto[]>();
  for (const wallet of rows) {
    const key = `${wallet.provenance}:${wallet.address}`;
    byKey.set(key, [...(byKey.get(key) ?? []), wallet]);
  }

  return [...byKey.entries()].flatMap(([key, members]) => {
    const [first] = members;
    if (first === undefined) return [];
    const managed = first.provenance === "provisioned";
    const verified = managed
      ? members.every((wallet) => wallet.verified)
      : members.some((wallet) => wallet.verified);
    return [
      {
        key,
        address: first.address,
        provenance: first.provenance,
        chains: members.map((wallet) => wallet.chain),
        verified,
        unproven: !managed && !verified ? first : undefined,
        createdAt: members.map((wallet) => wallet.createdAt).sort()[0] ?? first.createdAt,
      },
    ];
  });
}

function statusLabel(group: WalletGroup): string {
  if (group.provenance === "provisioned") return group.verified ? "Active" : "Setting up";
  return group.verified ? "Verified" : "Unproven";
}

function Wallets() {
  const wallets = useWallets();
  const balance = useWalletBalance();
  const rails = useMerchantRails();
  const withdrawalHistory = useWalletWithdrawalHistory();
  const withdraw = useWithdraw();
  const link = useLinkWallet();
  const provision = useProvisionWallet();
  const provisionEverywhere = useProvisionWalletEverywhere();
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
  /** The wallet table: one line per address, naming the networks it is on. */
  const groups = groupWallets(rows);
  /**
   * The merchant's own verified wallets: who can own a managed wallet, and where
   * a withdrawal may go. Never the managed one — moving money from a Safe to
   * itself is not a withdrawal.
   */
  const destinations = groups.filter(
    (group) => group.verified && group.provenance !== "provisioned",
  );
  const hasVerifiedWallet = destinations.length > 0;
  /**
   * The managed wallet's address: one address on every network, set up network
   * by network. Undefined until the merchant has one — and once they do, nothing
   * on this page offers to create another.
   */
  const managedAddress = groups.find((group) => group.provenance === "provisioned")?.address;
  /** One row per chain this deployment settles on, in the API's order (#244). */
  const chainBalances = balance.data?.balances ?? [];
  /** Whether every network with an address is paid into the managed wallet. */
  const paidIntoManaged =
    managedAddress !== undefined &&
    chainBalances.every((row) => row.address === null || row.address === managedAddress);
  /** The assets in the open withdraw dialog: the chosen chain's, never another's. */
  const balances = chainBalances.find((row) => row.chain === withdrawChain)?.balances ?? [];
  const withdrawalRows = withdrawalHistory.data?.withdrawals ?? [];

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
    setWithdrawTo(destinations[0]?.address ?? "");
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
      // Proved on any network is proved: the key holds this address everywhere.
      if (destinations.some((group) => group.address === account)) {
        setConnecting(false);
        setNotice("That wallet is already verified.");
        return;
      }
      const existing = rows.find((row) => row.chain === targetChain && row.address === account);

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
      setNotice("Wallet verified.");
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
   * Creates the managed wallet on every network at once: one address, deployed
   * on each. A network that fails keeps its card's "Set up" action, so the
   * merchant retries exactly that one.
   */
  async function createManagedWallet() {
    setFailure("");
    setNotice("");
    try {
      const { failed } = await provisionEverywhere.mutateAsync();
      const [firstFailure] = failed;
      if (firstFailure === undefined) {
        setNotice("Managed wallet created. It receives payments on every network below.");
        return;
      }
      setFailure(
        `Could not set up on ${failed.map((entry) => chainLabel(entry.chain)).join(", ")}: ${firstFailure.reason} Use "Set up" on that network to try again.`,
      );
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not create the managed wallet");
    }
  }

  /**
   * Sets the managed wallet up on one network (#244) — the same address the
   * merchant already has, deployed there. For a network added after the wallet
   * was created, or one that failed the first time.
   */
  async function provisionOn(target: string) {
    setFailure("");
    setNotice("");
    try {
      await provision.mutateAsync(target);
      setNotice(`Managed wallet set up on ${chainLabel(target)}.`);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not set up the wallet");
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
          {groups.length} wallet{groups.length === 1 ? "" : "s"}
        </p>
        {/* Until the merchant has a managed wallet, the header is the one place
            to get one, in the order it has to happen: prove a wallet you own,
            then create the managed wallet on every network at once. After that
            there is nothing left to add here — a network still missing it says
            so on its own card. The browser's wallet does the whole ceremony, so
            it leads; the typed-address path stays for a hardware signer, a Safe
            app, another machine. */}
        {managedAddress === undefined && (
          <span className="flex flex-wrap justify-end gap-2">
            {!hasVerifiedWallet && injected.length > 0 && (
              <Button
                variant="secondary"
                onClick={() => withWallet("connect", chain)}
                disabled={signing || chain === undefined}
              >
                <WalletIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                {signing ? "Check your wallet…" : `Connect ${chosen?.name ?? "wallet"}`}
              </Button>
            )}
            {!hasVerifiedWallet && (
              <Button
                variant="secondary"
                onClick={() => openConnect()}
                disabled={chain === undefined}
              >
                <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                Connect existing
              </Button>
            )}
            {hasVerifiedWallet && provisionChains.length > 0 && (
              <Button
                onClick={() => void createManagedWallet()}
                disabled={provisionEverywhere.isPending}
              >
                <WalletIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                {provisionEverywhere.isPending ? "Creating…" : "Create managed wallet"}
              </Button>
            )}
          </span>
        )}
      </div>

      {managedAddress === undefined && wallets.isSuccess && provisionChains.length > 0 && (
        <p className="text-muted-foreground text-sm">
          {hasVerifiedWallet
            ? "Next, create your managed wallet: one address that receives payments on every network below."
            : "Start by connecting a wallet you own. It proves who you are and becomes an owner of your managed wallet — connecting moves no funds."}
        </p>
      )}

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
            <div className="flex flex-col gap-1">
              <h2 className="font-medium text-sm">Settlement balances</h2>
              {paidIntoManaged && (
                <p className="text-muted-foreground text-xs">
                  Your managed wallet has the same address on every network. Each network holds its
                  own balance.
                </p>
              )}
            </div>
            {/* One card per chain: the same address holds a separate balance on
                each (#244), and showing one of them made the others' money
                invisible. Networks with an address first, so the funded card
                leads; stable, so the API's order holds within each group. */}
            <div className="grid gap-3 lg:grid-cols-2">
              {[...chainBalances]
                .sort((a, b) => Number(a.address === null) - Number(b.address === null))
                .map((row) => {
                  // The managed wallet's address, not deployed on this network yet.
                  const notSetUp =
                    row.address === null &&
                    managedAddress !== undefined &&
                    provisionChains.includes(row.chain);
                  return (
                    <Card key={row.chain} className="flex flex-col gap-4 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-col gap-1">
                          <h3 className="flex items-center gap-2 font-medium text-sm">
                            <ChainLabel chain={row.chain} />
                            {notSetUp && <Badge variant="warning">Not set up</Badge>}
                          </h3>
                          <p className="break-all mt-2 font-mono text-subtle-foreground text-sm">
                            {row.address ??
                              (notSetUp
                                ? managedAddress
                                : "No settlement address on this network yet")}
                          </p>
                        </div>
                        <span className="flex flex-wrap gap-2">
                          {notSetUp && (
                            <Button
                              variant="secondary"
                              onClick={() => void provisionOn(row.chain)}
                              disabled={provision.isPending}
                            >
                              <WalletIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                              Set up on {chainLabel(row.chain)}
                            </Button>
                          )}
                          {row.withdrawable && (
                            <Button
                              variant="secondary"
                              onClick={() => openWithdraw(row)}
                              disabled={row.balances.length === 0 || !hasVerifiedWallet}
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

                      {/* A network with no address says so in its subtitle already;
                        a second sentence repeating it only made the card taller. */}
                      {row.balances.length === 0 ? (
                        row.address !== null && (
                          <p className="text-muted-foreground text-sm">Nothing here yet.</p>
                        )
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

                      {notSetUp && (
                        <p className="text-muted-foreground text-xs">
                          Set it up to receive payments on {chainLabel(row.chain)} at this same
                          address.
                        </p>
                      )}
                      {row.address !== null && !row.withdrawable && (
                        <p className="text-muted-foreground text-xs">
                          This address is yours, not one Mayarin provisioned — withdraw from it in
                          your own wallet.
                        </p>
                      )}
                      {row.withdrawable && !hasVerifiedWallet && (
                        <p className="text-muted-foreground text-xs">
                          Connect and verify a wallet you own to withdraw to it.
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
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {networks.map((network) => {
                    const hasRails = network.rails.length > 0;
                    const partiallyAvailable = hasRails && network.unavailable.length > 0;
                    return (
                      <section
                        key={network.chain}
                        className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3"
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
              <TableCaption>Your wallets, one line per address</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Address</TableHead>
                  <TableHead>Networks</TableHead>
                  <TableHead>Origin</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => {
                  const unproven = group.unproven;
                  return (
                    <TableRow key={group.key}>
                      {/* Shown whole: an address a merchant cannot copy in full is
                          worse than one they have to scroll. */}
                      <TableCell className="break-all font-mono text-xs">{group.address}</TableCell>
                      <TableCell className="text-muted-foreground">
                        <span className="flex flex-wrap gap-x-3 gap-y-1">
                          {group.chains.map((chainId) => (
                            <ChainLabel key={chainId} chain={chainId} size={18} />
                          ))}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge>{PROVENANCE_LABEL[group.provenance]}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={group.verified ? "success" : "warning"}>
                          {statusLabel(group)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <time dateTime={isoAttr(group.createdAt)}>
                          {formatDateTime(group.createdAt)}
                        </time>
                      </TableCell>
                      {/* Only an action that is left to take. A managed wallet
                          still setting up is finished from its network's card. */}
                      <TableCell className="text-right">
                        {unproven !== undefined && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void startProof(unproven)}
                          >
                            <SealCheckIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                            Prove control
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
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
                          <TransactionLink
                            chain={row.chain}
                            transactionHash={row.transactionHash}
                          />
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
              proving this one address.
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
              Register an address you already control, then prove control of it in the next step.
              You prove it once — it counts on every network.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {failure !== "" && <Alert variant="destructive">{failure}</Alert>}
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
                An EVM address. The same key holds it on every network.
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
                items={destinations.map((wallet) => ({
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
                  {destinations.map((wallet) => (
                    <SelectItem key={wallet.key} value={wallet.address}>
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

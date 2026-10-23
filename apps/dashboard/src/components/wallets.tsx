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

import { Tabs } from "@base-ui-components/react/tabs";
import { chainLabel } from "@mayarin/chain";
import { isAssetCode } from "@mayarin/shared/asset";
import { formatMoneyLocale } from "@mayarin/shared/locale";
import { money } from "@mayarin/shared/money";
import {
  ArrowLineUpRightIcon,
  CheckCircleIcon,
  CheckIcon,
  CopyIcon,
  PlusIcon,
  SealCheckIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { match } from "ts-pattern";
import { AssetAmount, AssetLabel, AssetStack } from "@/components/asset-logo";
import { ChainLabel } from "@/components/chain-logo";
import { TransactionLink } from "@/components/transaction-link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CursorPagination } from "@/components/ui/cursor-pagination";
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
import { PageLoader } from "@/components/ui/page-loader";
import { QueryError, TableError } from "@/components/ui/query-error";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCursorPagination } from "@/hooks/cursor-pagination";
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
import { useUrlTab } from "@/hooks/url-tab";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, isoAttr } from "@/lib/date";
import { fromEditableDecimalString } from "@/lib/decimal-input";
import { ICON_CARD, ICON_NAV } from "@/lib/icons";
import { PAGE_SIZE } from "@/lib/pagination";
import {
  discoverSolanaWallet,
  discoverWallets,
  type InjectedSolanaWallet,
  type InjectedWallet,
  personalSign,
  requestAccount,
  requestSolanaAccount,
  solanaSign,
  walletErrorMessage,
} from "@/lib/wallet";
import { withQuery } from "@/lib/with-query";
import type {
  ChainBalanceDto,
  MerchantRailsResponse,
  WalletDto,
  WalletProvenance,
} from "@/types/settings";

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

/**
 * Networks shown before the cell starts pushing the table wide. The rest
 * collapse behind a count with a tooltip, the same way the agent endpoints and
 * payment links tables handle rails.
 */
const VISIBLE_NETWORK_COUNT = 2;

function NetworkList({ chains }: { readonly chains: readonly string[] }) {
  const visible = chains.slice(0, VISIBLE_NETWORK_COUNT);
  const hiddenLabels = chains.slice(VISIBLE_NETWORK_COUNT).map((chainId) => chainLabel(chainId));

  return (
    <span className="flex flex-nowrap items-center gap-3 whitespace-nowrap">
      {visible.map((chainId) => (
        <ChainLabel key={chainId} chain={chainId} size={18} />
      ))}
      {hiddenLabels.length > 0 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                // `aria-label` carries the whole list whether or not the tooltip
                // ever opens: a screen reader must not depend on hover.
                <Badge
                  variant="default"
                  className="cursor-default"
                  aria-label={`${hiddenLabels.length} more networks: ${hiddenLabels.join(", ")}`}
                >
                  +{hiddenLabels.length}
                </Badge>
              }
            />
            <TooltipContent>
              <span className="flex flex-col gap-0.5">
                {hiddenLabels.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </span>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </span>
  );
}

/**
 * What the success banner says, and the transaction it points at when there is
 * one to point at.
 */
interface Notice {
  readonly message: string;
  readonly transaction?: { readonly chain: string; readonly hash: string };
}

/**
 * The page's two halves.
 *
 * Addresses is the setup surface — balances, networks, the wallets themselves —
 * and history is a log that only grows. They were stacked on one scroll, which
 * put the thing a merchant reads once above the thing they come back to.
 */
const WALLET_TABS = ["addresses", "history"] as const;

type WalletTab = (typeof WALLET_TABS)[number];

function statusLabel(group: WalletGroup): string {
  if (group.provenance === "provisioned") return group.verified ? "Active" : "Setting up";
  return group.verified ? "Verified" : "Unproven";
}

/** A rail exclusion's kind, as a merchant reads it in one or two words. */
const EXCLUSION_LABEL: Readonly<Record<string, string>> = {
  "no-settlement-destination": "Wallet not set up",
  "settlement-address-has-no-code": "Address unusable here",
  "not-accepted": "Not accepted",
  "not-priceable": "Cannot be priced",
};

/**
 * What a network row shows: the asset it settles in, plus anything else that
 * is actually there. The API reads every stablecoin a chain carries, so money
 * settled before a switch still counts — but a zero in an asset the merchant is
 * not paid in on that chain is noise.
 */
function shownBalances(
  row: ChainBalanceDto,
  rails: MerchantRailsResponse | undefined,
): ChainBalanceDto {
  const settlesIn =
    rails?.rails.find((rail) => rail.chain === row.chain)?.settlementAsset ??
    rails?.settlementAsset;
  return {
    ...row,
    balances: row.balances.filter(
      (amount) => amount.asset === settlesIn || BigInt(amount.amount) > 0n,
    ),
  };
}

/** The same asset on every network, added up, in the API's own display form. */
function totalsOf(
  rows: readonly ChainBalanceDto[],
): readonly { readonly asset: string; readonly display: string }[] {
  const sums = new Map<string, bigint>();
  for (const row of rows) {
    for (const amount of row.balances) {
      sums.set(amount.asset, (sums.get(amount.asset) ?? 0n) + BigInt(amount.amount));
    }
  }
  return [...sums.entries()].flatMap(([asset, total]) =>
    isAssetCode(asset)
      ? [{ asset, display: formatMoneyLocale(money(total, asset), { trimTrailingZeros: true }) }]
      : [],
  );
}

/**
 * Balances and payment availability, as one account broken down by network.
 *
 * The managed wallet is one address on every network, so the address and the
 * total lead and each network is a row beneath them — the shape Safe, Stripe
 * Treasury and Zerion give a multi-network balance. It replaced a card per
 * network (the same address printed on each) and a separate availability card
 * that repeated "not set up" as "needs attention" without saying why.
 */
function SettlementOverview({
  chainBalances,
  rails,
  managedAddress,
  provisionChains,
  connectChains,
  hasVerifiedWallet,
  provisioning,
  connectingChain,
  onSetUp,
  onConnect,
  onWithdraw,
}: {
  readonly chainBalances: readonly ChainBalanceDto[];
  readonly rails: MerchantRailsResponse | undefined;
  /** Set only when every network with an address is paid into it. */
  readonly managedAddress: string | undefined;
  readonly provisionChains: readonly string[];
  readonly connectChains: readonly string[];
  readonly hasVerifiedWallet: boolean;
  readonly provisioning: boolean;
  readonly connectingChain: string | null;
  readonly onSetUp: (chain: string) => void;
  readonly onConnect: (chain: string) => void;
  readonly onWithdraw: (row: ChainBalanceDto) => void;
}) {
  const [copied, setCopied] = useState(false);
  const shown = chainBalances.map((row) => shownBalances(row, rails));
  const totals = totalsOf(shown.filter((row) => row.address !== null));
  const live = chainBalances.filter((row) => row.address !== null).length;
  // Networks with an address first, so money leads; stable, so the API's order
  // holds within each group.
  const ordered = [...shown].sort(
    (a, b) => Number(a.address === null) - Number(b.address === null),
  );

  function balancesOf(row: ChainBalanceDto) {
    return row.balances.length === 0 ? (
      <span className="text-subtle-foreground">—</span>
    ) : (
      <span className="flex flex-wrap gap-x-4 gap-y-1">
        {row.balances.map((amount) => (
          <AssetAmount
            key={amount.asset}
            asset={amount.asset}
            display={amount.display}
            size={16}
            className="whitespace-nowrap"
          />
        ))}
      </span>
    );
  }

  function paymentsOf(row: ChainBalanceDto) {
    const accepting = rails?.rails.filter((rail) => rail.chain === row.chain) ?? [];
    const excluded = [
      ...new Map(
        (rails?.unavailable ?? [])
          .filter((entry) => entry.chain === row.chain)
          .map((entry) => [`${entry.asset ?? "network"}:${entry.reason}`, entry]),
      ).values(),
    ];
    const [firstExclusion] = excluded;

    if (accepting.length > 0) {
      return (
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant="success">Accepting</Badge>
          <AssetStack assets={accepting.map((rail) => rail.asset)} />
          <span className="sr-only">{accepting.map((rail) => rail.asset).join(", ")}</span>
          {excluded.length > 0 && (
            <ExclusionHint entries={excluded} label={`${excluded.length} off`} />
          )}
        </span>
      );
    }
    return firstExclusion !== undefined ? (
      <ExclusionHint
        entries={excluded}
        label={EXCLUSION_LABEL[firstExclusion.kind] ?? "Unavailable"}
        badge
      />
    ) : (
      <Badge variant="warning">Unavailable</Badge>
    );
  }

  function actionOf(row: ChainBalanceDto) {
    // The managed wallet's address, not deployed on this network yet.
    const notSetUp =
      row.address === null && managedAddress !== undefined && provisionChains.includes(row.chain);
    if (notSetUp) {
      return (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onSetUp(row.chain)}
          disabled={provisioning}
        >
          <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
          Set up
        </Button>
      );
    }
    if (row.address === null && connectChains.includes(row.chain)) {
      const busy = connectingChain === row.chain;
      return (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onConnect(row.chain)}
          disabled={connectingChain !== null}
        >
          <WalletIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
          {busy ? "Connecting…" : "Connect wallet"}
        </Button>
      );
    }
    if (row.withdrawable) {
      return (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onWithdraw(row)}
          disabled={row.balances.length === 0 || !hasVerifiedWallet}
          title={
            hasVerifiedWallet ? undefined : "Connect and verify a wallet you own to withdraw to it."
          }
        >
          <ArrowLineUpRightIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
          Withdraw
        </Button>
      );
    }
    return row.address !== null ? (
      <span className="text-subtle-foreground text-xs">Your own wallet</span>
    ) : null;
  }

  async function copyAddress() {
    if (managedAddress === undefined) return;
    try {
      await navigator.clipboard.writeText(managedAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // The address is on screen in full; copying by hand still works.
    }
  }

  return (
    <Card className="flex flex-col gap-0 overflow-hidden p-0">
      <div className="flex flex-col gap-4 border-border border-b p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="font-medium text-sm">Settlement balances</h2>
            <p className="text-muted-foreground text-xs">
              {live} of {chainBalances.length} networks set up
              {rails !== undefined && <> · default settlement {rails.settlementAsset}</>}
            </p>
          </div>
          {managedAddress !== undefined && (
            <div className="flex min-w-0 items-center gap-2">
              <Badge>Managed</Badge>
              <span className="font-mono text-muted-foreground text-xs md:hidden">
                {`${managedAddress.slice(0, 6)}…${managedAddress.slice(-4)}`}
              </span>
              <span className="hidden break-all font-mono text-muted-foreground text-xs md:inline">
                {managedAddress}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void copyAddress()}
                aria-label="Copy wallet address"
              >
                {copied ? (
                  <CheckIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                ) : (
                  <CopyIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                )}
              </Button>
            </div>
          )}
        </div>
        {totals.length > 0 && (
          <dl className="flex flex-wrap gap-x-8 gap-y-2">
            {totals.map((total) => (
              <div key={total.asset} className="flex flex-col gap-1">
                <dt className="sr-only">{total.asset} across every network</dt>
                <dd className="font-mono text-xl tabular-nums">
                  <AssetAmount asset={total.asset} display={total.display} size={22} />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {/* A table from `md` up; on a phone each network is a short stack, since
          four columns do not fit and a sideways scroll hides the action. */}
      <Table containerClassName="hidden rounded-none border-0 md:block">
        <TableCaption className="sr-only">Balance and payment status per network</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Network</TableHead>
            <TableHead>Balance</TableHead>
            <TableHead>Payments</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Action</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ordered.map((row) => (
            <TableRow key={row.chain}>
              <TableCell>
                <ChainLabel chain={row.chain} size={20} className="whitespace-nowrap" />
              </TableCell>
              <TableCell className="font-mono tabular-nums">{balancesOf(row)}</TableCell>
              <TableCell>{paymentsOf(row)}</TableCell>
              <TableCell className="text-right">{actionOf(row)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ul className="flex flex-col divide-y divide-border md:hidden">
        {ordered.map((row) => (
          <li key={row.chain} className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <ChainLabel chain={row.chain} size={20} className="whitespace-nowrap font-medium" />
              {actionOf(row)}
            </div>
            <div className="font-mono text-sm tabular-nums">{balancesOf(row)}</div>
            <div>{paymentsOf(row)}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Why a network, or some of its assets, is not offered. The label is the short
 * answer; the reasons the rail catalog wrote are one hover or focus away, and in
 * the accessible name either way.
 */
function ExclusionHint({
  entries,
  label,
  badge = false,
}: {
  readonly entries: readonly MerchantRailsResponse["unavailable"][number][];
  readonly label: string;
  readonly badge?: boolean;
}) {
  const reasons = entries.map((entry) => `${entry.asset ?? "Network"}: ${entry.reason}`);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            badge ? (
              <Badge
                variant="warning"
                className="cursor-default"
                aria-label={`${label}. ${reasons.join(" ")}`}
              >
                {label}
              </Badge>
            ) : (
              <button
                type="button"
                className="cursor-default text-subtle-foreground text-xs underline decoration-dotted underline-offset-2"
                aria-label={`${label}. ${reasons.join(" ")}`}
              >
                {label}
              </button>
            )
          }
        />
        <TooltipContent>
          <span className="flex max-w-xs flex-col gap-1">
            {reasons.map((reason) => (
              <span key={reason}>{reason}</span>
            ))}
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function Wallets() {
  const wallets = useWallets();
  const balance = useWalletBalance();
  const rails = useMerchantRails();
  // In the URL, so a reload — or a link sent to a colleague — opens the tab
  // they were actually on.
  const [activeTab, setActiveTab] = useUrlTab<WalletTab>("tab", WALLET_TABS, "addresses");
  const historyPagination = useCursorPagination();
  const withdrawalHistory = useWalletWithdrawalHistory(historyPagination.cursor);
  const withdraw = useWithdraw();
  const link = useLinkWallet();
  const provision = useProvisionWallet();
  const provisionEverywhere = useProvisionWalletEverywhere();
  const challenge = useWalletChallenge();
  const verify = useVerifyWallet();

  /**
   * One loader for the whole tab.
   *
   * Balances, availability and the wallet list are three queries that fire
   * together and land within a moment of each other; a spinner each meant three
   * of them stacked down the page. Gated here rather than inside each block,
   * which is why those blocks no longer carry a pending branch of their own.
   */
  const addressesPending = balance.isPending || rails.isPending || wallets.isPending;

  const [connecting, setConnecting] = useState(false);
  /** The network an address is being linked on. Wallet records are per chain. */
  const [connectChain, setConnectChain] = useState("");
  const [address, setAddress] = useState("");
  const [ceremony, setCeremony] = useState<Ceremony | null>(null);
  const [signature, setSignature] = useState("");
  const [failure, setFailure] = useState("");
  /**
   * The banner above the balances, and the transaction it is about when it has
   * one.
   *
   * Carried as a value rather than an interpolated string so a hash can render
   * as the shortened explorer link the history table already uses: a 66-character
   * hash in a sentence is unreadable and unclickable.
   */
  const [notice, setNotice] = useState<Notice | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  /** Which chain's wallet the open dialog moves from. A merchant has one per chain. */
  const [withdrawChain, setWithdrawChain] = useState("");
  const [withdrawAsset, setWithdrawAsset] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawTo, setWithdrawTo] = useState("");
  const [withdrawFailure, setWithdrawFailure] = useState("");
  /** Every wallet this browser announced. Empty once discovery has finished with none. */
  const [injected, setInjected] = useState<readonly InjectedWallet[]>([]);
  const [solanaWallet, setSolanaWallet] = useState<InjectedSolanaWallet | null>(null);
  const [signing, setSigning] = useState(false);
  /** The row whose browser-wallet prompt is active; keeps loading local to that row. */
  const [connectingChain, setConnectingChain] = useState<string | null>(null);
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
    setSolanaWallet(discoverSolanaWallet() ?? null);
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
      if (injected.length === 0) {
        openConnect(selectedChain);
        setFailure(
          "No EVM wallet was detected. Install or unlock a browser wallet, or enter your address below.",
        );
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
  /** Every chain where a merchant-held wallet can be verified and receive settlement. */
  const connectChains = wallets.data?.connectChains ?? [];
  const connectingSolana = connectChain.startsWith("solana-");
  const ceremonySolana = ceremony?.wallet.chain.startsWith("solana-") === true;
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
    setNotice(null);
    setAddress("");
    setConnectChain(targetChain);
    setConnecting(true);
  }

  function openWithdraw(row: ChainBalanceDto) {
    setWithdrawFailure("");
    setNotice(null);
    setWithdrawAmount("");
    setWithdrawChain(row.chain);
    setWithdrawAsset(row.balances[0]?.asset ?? "");
    setWithdrawTo(destinations[0]?.address ?? "");
    setWithdrawing(true);
  }

  async function submitWithdrawal() {
    setWithdrawFailure("");
    setNotice(null);
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
      setNotice({
        message: "Withdrawal submitted:",
        transaction: { chain: withdrawChain, hash: txHash },
      });
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
    setNotice(null);
    setSigning(true);
    try {
      const account = await requestAccount(wallet.provider);
      // Proved on any network is proved: the key holds this address everywhere.
      if (destinations.some((group) => group.address === account)) {
        setConnecting(false);
        setNotice({ message: "That wallet is already verified." });
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
      setNotice({ message: "Wallet verified." });
    } catch (error) {
      const reason = error instanceof ApiError ? error.message : walletErrorMessage(error);
      // `undefined` is the merchant closing their wallet's prompt, which is a
      // decision rather than a failure.
      if (reason !== undefined) setFailure(reason);
    } finally {
      setSigning(false);
    }
  }

  /** Connects and verifies a Phantom-compatible wallet in one signed ceremony. */
  async function connectSolana(targetChain: string) {
    if (targetChain === "") return;
    if (solanaWallet === null) {
      openConnect(targetChain);
      setFailure(
        "No Solana wallet was detected. Install or unlock Phantom, or enter your address below.",
      );
      return;
    }
    setFailure("");
    setNotice(null);
    setSigning(true);
    setConnectingChain(targetChain);
    try {
      const account = await requestSolanaAccount(solanaWallet.provider);
      const existing = rows.find((row) => row.chain === targetChain && row.address === account);
      if (existing?.verified === true) {
        setNotice({ message: "That Solana wallet is already verified." });
        return;
      }
      const row =
        existing ?? (await link.mutateAsync({ chain: targetChain, address: account })).wallet;
      const issued = await challenge.mutateAsync(row.id);
      const signed = await solanaSign(solanaWallet.provider, issued.message);
      await verify.mutateAsync({
        walletId: row.id,
        challengeId: issued.challengeId,
        signature: signed,
      });
      setConnecting(false);
      setNotice({ message: "Solana wallet verified. Payments can now settle directly to it." });
    } catch (error) {
      const reason = error instanceof ApiError ? error.message : walletErrorMessage(error);
      if (reason !== undefined) setFailure(reason);
    } finally {
      setSigning(false);
      setConnectingChain(null);
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
    setNotice(null);
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
      setNotice({ message: "Wallet verified. It can be paid." });
    } catch (error) {
      const reason = error instanceof ApiError ? error.message : walletErrorMessage(error);
      if (reason !== undefined) setFailure(reason);
    } finally {
      setSigning(false);
    }
  }

  /** Completes a manually-started Solana proof with the injected wallet. */
  async function signSolanaCeremony() {
    const active = ceremony;
    if (active === null || solanaWallet === null) return;
    setFailure("");
    setNotice(null);
    setSigning(true);
    try {
      const account = await requestSolanaAccount(solanaWallet.provider);
      if (account !== active.wallet.address) {
        setFailure(`Switch ${solanaWallet.name} to ${active.wallet.address} and try again.`);
        return;
      }
      const signed = await solanaSign(solanaWallet.provider, active.message);
      await verify.mutateAsync({
        walletId: active.wallet.id,
        challengeId: active.challengeId,
        signature: signed,
      });
      setCeremony(null);
      setNotice({ message: "Solana wallet verified. Payments can now settle directly to it." });
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
    setNotice(null);
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
    setNotice(null);
    try {
      const { failed } = await provisionEverywhere.mutateAsync();
      const [firstFailure] = failed;
      if (firstFailure === undefined) {
        setNotice({
          message: "Managed wallet created. It receives payments on every network below.",
        });
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
    setNotice(null);
    try {
      await provision.mutateAsync(target);
      setNotice({ message: `Managed wallet set up on ${chainLabel(target)}.` });
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not set up the wallet");
    }
  }

  async function startProof(wallet: WalletDto) {
    setFailure("");
    setNotice(null);
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
    setNotice(null);
    try {
      await verify.mutateAsync({
        walletId: ceremony.wallet.id,
        challengeId: ceremony.challengeId,
        signature: signature.trim(),
      });
      setCeremony(null);
      setNotice({ message: "Wallet verified. It can be paid." });
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "That signature did not verify");
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <Tabs.Root
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as WalletTab)}
        className="flex flex-1 flex-col"
      >
        <Tabs.List
          aria-label="Wallet sections"
          className="flex w-full overflow-x-auto border-border border-b"
        >
          {(
            [
              ["addresses", "Addresses"],
              ["history", "History"],
            ] as const
          ).map(([value, label]) => (
            <Tabs.Tab
              key={value}
              value={value}
              className="min-h-11 shrink-0 cursor-pointer border-transparent border-b-2 px-4 font-sans text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-active:border-brand data-active:text-foreground dark:data-active:border-electric"
            >
              {label}
            </Tabs.Tab>
          ))}
        </Tabs.List>

        <Tabs.Panel
          value="addresses"
          className="flex flex-1 flex-col gap-4 pt-6 focus-visible:outline-none"
        >
          {addressesPending ? (
            <PageLoader label="Loading wallets" />
          ) : (
            <>
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

              {notice !== null && (
                <Alert role="status" className="flex flex-wrap items-center gap-2">
                  <CheckCircleIcon
                    size={ICON_NAV}
                    weight="fill"
                    className="shrink-0 text-success"
                  />
                  {notice.message}
                  {notice.transaction !== undefined && (
                    <TransactionLink
                      chain={notice.transaction.chain}
                      transactionHash={notice.transaction.hash}
                    />
                  )}
                </Alert>
              )}

              {/* The balance sits above the wallet list because it is the question a
          merchant opens this page with. Read from the chain, not the ledger:
          once settlement lands on-chain the money is theirs, not Mayarin's to
          account for. */}
              {balance.isError ? (
                <QueryError
                  message={reasonOf(balance.error)}
                  retry={() => void balance.refetch()}
                  retrying={balance.isFetching}
                />
              ) : rails.isError ? (
                <QueryError
                  message={reasonOf(rails.error)}
                  retry={() => void rails.refetch()}
                  retrying={rails.isFetching}
                />
              ) : (
                <SettlementOverview
                  chainBalances={chainBalances}
                  rails={rails.data}
                  managedAddress={paidIntoManaged ? managedAddress : undefined}
                  provisionChains={provisionChains}
                  connectChains={connectChains}
                  hasVerifiedWallet={hasVerifiedWallet}
                  provisioning={provision.isPending}
                  connectingChain={connectingChain}
                  onSetUp={(target) => void provisionOn(target)}
                  onConnect={(target) =>
                    target.startsWith("solana-")
                      ? void connectSolana(target)
                      : withWallet("connect", target)
                  }
                  onWithdraw={openWithdraw}
                />
              )}

              {failure !== "" && ceremony === null && !connecting && (
                <Alert variant="destructive">{failure}</Alert>
              )}

              {match(wallets)
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
                      <EmptyDescription>
                        Connect an address you control to continue.
                      </EmptyDescription>
                      <EmptyAction className="flex flex-wrap justify-center gap-2">
                        <Button variant="secondary" onClick={() => openConnect()}>
                          Connect existing
                        </Button>
                      </EmptyAction>
                    </Empty>
                  ) : (
                    <>
                      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card md:hidden">
                        {groups.map((group) => {
                          const unproven = group.unproven;
                          return (
                            <li key={group.key} className="flex flex-col gap-3 p-4">
                              {/* Whole, and wrapped: an address a merchant cannot
                                copy in full is worse than one on two lines. */}
                              <span className="break-all font-mono text-xs">{group.address}</span>
                              <span className="text-muted-foreground text-sm">
                                <NetworkList chains={group.chains} />
                              </span>
                              <span className="flex flex-wrap items-center gap-2">
                                <Badge>{PROVENANCE_LABEL[group.provenance]}</Badge>
                                <Badge variant={group.verified ? "success" : "warning"}>
                                  {statusLabel(group)}
                                </Badge>
                                <time
                                  dateTime={isoAttr(group.createdAt)}
                                  className="text-muted-foreground text-xs"
                                >
                                  {formatDateTime(group.createdAt)}
                                </time>
                              </span>
                              {unproven !== undefined && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="self-start"
                                  onClick={() => void startProof(unproven)}
                                >
                                  <SealCheckIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                                  Prove control
                                </Button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      <Table containerClassName="hidden md:block">
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
                                <TableCell className="break-all font-mono text-xs">
                                  {group.address}
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  <NetworkList chains={group.chains} />
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
                                      <SealCheckIcon
                                        size={ICON_NAV}
                                        weight="bold"
                                        aria-hidden="true"
                                      />
                                      Prove control
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </>
                  ),
                )}
            </>
          )}
        </Tabs.Panel>

        <Tabs.Panel
          value="history"
          className="flex flex-1 flex-col gap-3 pt-6 focus-visible:outline-none"
        >
          <SectionHeader title="Withdrawal history" />
          {match(withdrawalHistory)
            .with({ isPending: true }, () => <TableSkeleton rows={PAGE_SIZE} />)
            .with({ isError: true }, ({ error }) => (
              <TableError
                message={withdrawalReasonOf(error)}
                retry={() => void withdrawalHistory.refetch()}
                retrying={withdrawalHistory.isFetching}
              />
            ))
            .otherwise(() =>
              // Only the first page can say "no withdrawals yet": an empty page
              // deeper in is the end of history, and the pager is what a reader
              // needs there, not an empty state telling them they have none.
              withdrawalRows.length === 0 && !historyPagination.canPrevious ? (
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
                <div className="flex flex-col gap-4">
                  <Table>
                    <TableCaption>Successful managed-wallet withdrawals, newest first</TableCaption>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Completed</TableHead>
                        {/* The same address holds a balance on every network, so
                            an amount without its network does not say which
                            balance moved. */}
                        <TableHead>Network</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Network fee</TableHead>
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
                            <TableCell className="text-muted-foreground">
                              <ChainLabel chain={row.chain} size={18} />
                            </TableCell>
                            <TableCell className="text-right">
                              <AssetAmount asset={row.amount.asset} display={row.amount.display} />
                            </TableCell>
                            <TableCell className="text-right">
                              <AssetAmount
                                asset={row.networkFee.asset}
                                display={row.networkFee.display}
                              />
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

                  <CursorPagination
                    label="Withdrawal pages"
                    page={historyPagination.page}
                    canPrevious={historyPagination.canPrevious}
                    nextCursor={withdrawalHistory.data?.nextCursor}
                    busy={withdrawalHistory.isFetching}
                    onPrevious={historyPagination.previous}
                    onNext={historyPagination.next}
                  />
                </div>
              ),
            )}
        </Tabs.Panel>
      </Tabs.Root>

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
            <DialogTitle>
              {connectingSolana ? "Connect a Solana wallet" : "Connect an existing wallet"}
            </DialogTitle>
            <DialogDescription>
              {connectingSolana
                ? "Connect Phantom to verify your Solana address, or enter an address to complete the proof manually."
                : "Register an address you already control, then prove control of it in the next step. You prove it once — it counts on every EVM network."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {failure !== "" && <Alert variant="destructive">{failure}</Alert>}
            {connectingSolana && solanaWallet !== null && connectChain !== "" && (
              <Button
                variant="secondary"
                onClick={() => void connectSolana(connectChain)}
                disabled={signing}
              >
                <WalletIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                {signing ? "Check Phantom…" : `Use ${solanaWallet.name}`}
              </Button>
            )}
            {!connectingSolana && injected.length > 0 && connectChain !== "" && (
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
              <FieldLabel htmlFor="wallet-address">
                {connectingSolana ? "Solana address" : "Address"}
              </FieldLabel>
              <Input
                id="wallet-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={connectingSolana ? "Base58 address" : "0x…"}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="font-mono text-xs"
              />
              <FieldDescription>
                {connectingSolana
                  ? "The devnet address that should receive your Solana settlement."
                  : "An EVM address. The same key holds it on every EVM network."}
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

            {ceremonySolana && solanaWallet !== null && (
              <Button onClick={() => void signSolanaCeremony()} disabled={signing}>
                <WalletIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                {signing ? "Check Phantom…" : `Sign with ${solanaWallet.name}`}
              </Button>
            )}

            {!ceremonySolana && injected.length > 0 && (
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
                {(ceremonySolana ? solanaWallet === null : injected.length === 0)
                  ? "Signature"
                  : "Signature (or paste one)"}
              </FieldLabel>
              <Textarea
                id="wallet-signature"
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                rows={3}
                placeholder={ceremonySolana ? "Base64 signature" : "0x…"}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="font-mono text-xs"
              />
              {ceremonySolana && (
                <FieldDescription>
                  Solana signatures are 64-byte Ed25519 signatures encoded as base64.
                </FieldDescription>
              )}
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

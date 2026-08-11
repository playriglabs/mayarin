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

import { isAssetCode } from "@mayarin/shared/asset";
import { fromDecimalString } from "@mayarin/shared/money";
import {
  ArrowLineUpRightIcon,
  CheckCircleIcon,
  PlusIcon,
  SealCheckIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { match } from "ts-pattern";
import { AssetLabel } from "@/components/asset-logo";
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
  useProvisionWallet,
  useVerifyWallet,
  useWalletBalance,
  useWalletChallenge,
  useWallets,
  useWithdraw,
} from "@/hooks/settings";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD, ICON_NAV } from "@/lib/icons";
import {
  discoverWallets,
  type InjectedWallet,
  personalSign,
  requestAccount,
  walletErrorMessage,
} from "@/lib/wallet";
import { withQuery } from "@/lib/with-query";
import type { WalletDto, WalletProvenance } from "@/types/settings";

/** One chain, deployed and proven, before address derivation multiplies. */
const CHAIN = "base-sepolia";

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

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load wallets";
}

function Wallets() {
  const wallets = useWallets();
  const balance = useWalletBalance();
  const withdraw = useWithdraw();
  const link = useLinkWallet();
  const provision = useProvisionWallet();
  const challenge = useWalletChallenge();
  const verify = useVerifyWallet();

  const [connecting, setConnecting] = useState(false);
  const [address, setAddress] = useState("");
  const [ceremony, setCeremony] = useState<Ceremony | null>(null);
  const [signature, setSignature] = useState("");
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
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
  function withWallet(action: "connect" | "sign") {
    if (chosen !== null) {
      void (action === "connect" ? connectInjected(chosen) : signCeremonyWith(chosen));
      return;
    }
    setPicking(action);
  }

  function pick(wallet: InjectedWallet) {
    setChosen(wallet);
    const action = picking;
    setPicking(null);
    void (action === "connect" ? connectInjected(wallet) : signCeremonyWith(wallet));
  }

  const rows = wallets.data?.wallets ?? [];
  const balances = balance.data?.balances ?? [];
  /**
   * Where a withdrawal may go: the merchant's own verified wallets, and never
   * the managed one — moving money from a Safe to itself is not a withdrawal.
   */
  const destinations = rows.filter(
    (wallet) => wallet.verified && wallet.provenance !== "provisioned",
  );

  function openWithdraw() {
    setWithdrawFailure("");
    setWithdrawAmount("");
    setWithdrawAsset(balances[0]?.asset ?? "");
    setWithdrawTo(destinations[0]?.address ?? "");
    setWithdrawing(true);
  }

  async function submitWithdrawal() {
    setWithdrawFailure("");
    if (!isAssetCode(withdrawAsset)) {
      setWithdrawFailure("Pick an asset to withdraw");
      return;
    }
    // Parsed against the asset's own precision rather than multiplied by a
    // float: eighteen decimals of ETH do not survive a Number.
    let minorUnits: bigint;
    try {
      minorUnits = fromDecimalString(withdrawAmount.trim(), withdrawAsset).amount;
    } catch {
      setWithdrawFailure(`That is not a valid ${withdrawAsset} amount`);
      return;
    }

    try {
      const { txHash } = await withdraw.mutateAsync({
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
  async function connectInjected(wallet: InjectedWallet) {
    setFailure("");
    setSigning(true);
    try {
      const account = await requestAccount(wallet.provider);
      const existing = rows.find((row) => row.address === account);
      if (existing?.verified === true) {
        setNotice("That wallet is already verified.");
        return;
      }

      const row = existing ?? (await link.mutateAsync({ chain: CHAIN, address: account })).wallet;
      const issued = await challenge.mutateAsync(row.id);
      const signature = await personalSign(wallet.provider, account, issued.message);
      await verify.mutateAsync({
        walletId: row.id,
        challengeId: issued.challengeId,
        signature,
      });
      setNotice("Wallet verified. It can be paid.");
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
    setFailure("");
    try {
      const { wallet } = await link.mutateAsync({ chain: CHAIN, address: address.trim() });
      setConnecting(false);
      setAddress("");
      setNotice("Wallet connected. Prove control of it to be paid there.");
      // Straight into the proof: an unverified wallet cannot be paid, so
      // stopping here would leave the merchant one step short of the point.
      await startProof(wallet);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not connect that address");
    }
  }

  async function provisionManaged() {
    setFailure("");
    try {
      await provision.mutateAsync(CHAIN);
      setNotice("Managed wallet ready.");
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not provision a wallet");
    }
  }

  async function startProof(wallet: WalletDto) {
    setFailure("");
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
        <span className="flex gap-2">
          {/* The browser's wallet does the whole ceremony, so it is the primary
              action wherever there is one. The typed-address path stays for a
              wallet that is not in this browser — a hardware signer, a Safe
              app, another machine. */}
          {injected.length > 0 && (
            <Button variant="secondary" onClick={() => withWallet("connect")} disabled={signing}>
              <WalletIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
              {signing ? "Check your wallet…" : `Connect ${chosen?.name ?? "wallet"}`}
            </Button>
          )}
          <Button variant="secondary" onClick={() => setConnecting(true)}>
            <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
            Connect existing
          </Button>
          <Button onClick={provisionManaged} disabled={provision.isPending}>
            <WalletIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
            Create managed wallet
          </Button>
        </span>
      </div>

      <p aria-live="polite" className="sr-only">
        {notice}
      </p>

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
        .otherwise(({ data }) => (
          <Card className="flex flex-col gap-4 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="font-medium text-sm">Settlement balance</h2>
                <p className="break-all font-mono text-subtle-foreground text-sm">
                  {data?.address ?? "No settlement address yet"}
                </p>
              </div>
              {data?.withdrawable === true && (
                <Button
                  variant="secondary"
                  onClick={openWithdraw}
                  disabled={balances.length === 0 || destinations.length === 0}
                >
                  <ArrowLineUpRightIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                  Withdraw
                </Button>
              )}
            </div>

            {balances.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {data?.address == null
                  ? "Create a managed wallet or set a settlement address to be paid."
                  : "Nothing here yet."}
              </p>
            ) : (
              <dl className="flex flex-wrap gap-6">
                {balances.map((amount) => (
                  <div key={amount.asset} className="flex flex-col gap-1">
                    <dt className="text-muted-foreground text-xs uppercase">
                      <AssetLabel symbol={amount.asset} size={18} />
                    </dt>
                    <dd className="font-mono text-lg tabular-nums">{amount.display}</dd>
                  </div>
                ))}
              </dl>
            )}

            {data?.address != null && data.withdrawable === false && (
              <p className="text-muted-foreground text-xs">
                This address is yours, not one Mayarin provisioned — withdraw from it in your own
                wallet.
              </p>
            )}
            {data?.withdrawable === true && destinations.length === 0 && (
              <p className="text-muted-foreground text-xs">
                Connect and verify an address you control to withdraw to it.
              </p>
            )}
          </Card>
        ))}

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
              <EmptyDescription>
                Create a managed wallet or connect an address you control.
              </EmptyDescription>
              <EmptyAction className="flex flex-wrap justify-center gap-2">
                <Button variant="secondary" onClick={() => setConnecting(true)}>
                  Connect existing
                </Button>
                <Button onClick={provisionManaged} disabled={provision.isPending}>
                  Create managed wallet
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
                    <TableCell className="text-muted-foreground">{wallet.chain}</TableCell>
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
                className="justify-start"
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
            <Field>
              <FieldLabel htmlFor="wallet-address">Address</FieldLabel>
              <Input
                id="wallet-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="0x…"
                className="font-mono text-xs"
              />
              <FieldDescription>On {CHAIN}.</FieldDescription>
            </Field>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button onClick={connect} disabled={address.trim() === "" || link.isPending}>
              Connect
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
                  <SelectValue placeholder="Select an asset" />
                </SelectTrigger>
                <SelectContent>
                  {balances.map((amount) => (
                    <SelectItem key={amount.asset} value={amount.asset}>
                      <AssetLabel symbol={amount.asset} size={18} />
                      <span>— {amount.display}</span>
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
                className="font-mono text-xs"
              />
              <FieldDescription>
                Gas is paid in the chain's own currency, so a withdrawal costs slightly more than it
                moves.
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
              Withdraw
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
              Verify
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default withQuery(Wallets);

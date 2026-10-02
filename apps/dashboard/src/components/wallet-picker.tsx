/**
 * Which installed wallet signs (#313).
 *
 * Several extensions can sit in one browser — MetaMask, Phantom, … — and the
 * key a transaction needs lives in one of them. `pick` runs the action at once
 * when there is a single wallet, and otherwise opens a picker that closes as
 * soon as one is chosen.
 */

import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { discoverWallets, type InjectedWallet } from "@/lib/wallet";

type Signer = (wallet: InjectedWallet) => void;

export function useWalletPicker(description: string): {
  /** Runs `then` with the chosen wallet; `false` when no wallet is installed. */
  readonly pick: (then: Signer) => boolean;
  /** The picker dialog, rendered once by the caller. */
  readonly picker: ReactNode;
} {
  const [wallets, setWallets] = useState<readonly InjectedWallet[]>([]);
  const [pending, setPending] = useState<{ readonly then: Signer } | undefined>();

  useEffect(() => {
    let live = true;
    void discoverWallets().then((found) => {
      if (live) setWallets(found);
    });
    return () => {
      live = false;
    };
  }, []);

  function pick(then: Signer): boolean {
    const [only] = wallets;
    if (only === undefined) return false;
    if (wallets.length === 1) then(only);
    else setPending({ then });
    return true;
  }

  const picker = (
    <Dialog
      open={pending !== undefined}
      onOpenChange={(next) => {
        if (!next) setPending(undefined);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign with</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {wallets.map((wallet) => (
            <Button
              key={wallet.name}
              variant="secondary"
              className="justify-start"
              onClick={() => {
                const chosen = pending;
                setPending(undefined);
                chosen?.then(wallet);
              }}
            >
              {wallet.icon !== undefined && (
                <img src={wallet.icon} alt="" className="size-5 rounded-sm" />
              )}
              {wallet.name}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );

  return { pick, picker };
}

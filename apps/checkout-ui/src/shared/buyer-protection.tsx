import { useState } from "react";
import type { Protection, Rail } from "./types.ts";
import { connectWallet } from "./wallet.ts";

/**
 * Buyer protection, offered before the price is locked (#304).
 *
 * Everything the buyer is agreeing to is on the page before they connect: how
 * long the hold is, who decides a dispute, and what happens if nobody does. A
 * merchant's protection is optional for the buyer — paying from an exchange
 * cannot release anything, so it simply pays the merchant — while an escrow the
 * merchant asked for on this one payment needs the wallet.
 */
export function BuyerProtection({
  protection,
  rail,
  payerAddress,
  onPayerAddress,
}: {
  readonly protection: Protection | null;
  readonly rail: Rail | undefined;
  readonly payerAddress: string | null;
  readonly onPayerAddress: (address: string | null) => void;
}) {
  const [error, setError] = useState("");
  if (!protectionApplies(protection, rail)) return null;

  async function connect() {
    setError("");
    try {
      onPayerAddress(await connectWallet());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to connect a wallet");
    }
  }

  return (
    <div className="escrow-note">
      <p>
        <strong>Buyer protection.</strong> Your payment is held for{" "}
        {holdDuration(protection.holdSeconds)} until you confirm delivery. Disputes are decided by{" "}
        {protection.arbiterLabel}; if undecided, you're refunded.
      </p>
      <p>
        {protection.required
          ? "Connect your wallet to release or dispute later."
          : "Connect your wallet to turn it on."}
      </p>
      {payerAddress === null ? (
        <button type="button" className="secondary" onClick={() => void connect()}>
          Connect wallet
        </button>
      ) : (
        <p className="escrow-wallet">
          Protected · wallet <code>{shortAddress(payerAddress)}</code>{" "}
          {!protection.required && (
            <button type="button" className="link-button" onClick={() => onPayerAddress(null)}>
              Remove
            </button>
          )}
        </p>
      )}
      {error !== "" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Whether protection is on offer for this rail: the merchant offers it, on this chain. */
export function protectionApplies(
  protection: Protection | null,
  rail: Rail | undefined,
): protection is Protection {
  return protection !== null && rail !== undefined && protection.chains.includes(rail.chain);
}

/** The rail to send: with the payer's wallet when protection is taken up. */
export function railBody(
  rail: Rail,
  protection: Protection | null,
  payerAddress: string | null,
): { asset: string; chain: string; payerAddress?: string } {
  return protectionApplies(protection, rail) && payerAddress !== null
    ? { asset: rail.asset, chain: rail.chain, payerAddress }
    : { asset: rail.asset, chain: rail.chain };
}

export function holdDuration(seconds: number): string {
  const days = Math.round(seconds / 86_400);
  if (days >= 1) return days === 1 ? "1 day" : `${days} days`;
  const hours = Math.max(1, Math.round(seconds / 3_600));
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

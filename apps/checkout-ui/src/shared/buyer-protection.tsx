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

  // One line up front — what protection is, and the one action. The terms stay
  // on the page, one click away, so the card does not outweigh the pay button.
  return (
    <div className="escrow-note">
      <div className="escrow-row">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="escrow-icon">
          <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" />
          {payerAddress !== null && <path d="m8.5 12 2.5 2.5 4.5-5" />}
        </svg>
        <div className="escrow-copy">
          <p>
            <strong>Buyer protection</strong>
            {!protection.required && payerAddress === null && " · optional"}
          </p>
          <p>
            {payerAddress === null ? (
              `Held ${holdDuration(protection.holdSeconds)} until you confirm delivery`
            ) : (
              <>
                On · wallet <code>{shortAddress(payerAddress)}</code>
              </>
            )}
          </p>
        </div>
        {payerAddress === null ? (
          <button type="button" className="escrow-action" onClick={() => void connect()}>
            Connect wallet
          </button>
        ) : (
          !protection.required && (
            <button type="button" className="link-button" onClick={() => onPayerAddress(null)}>
              Remove
            </button>
          )
        )}
      </div>
      <details className="escrow-terms">
        <summary>How it works</summary>
        <p>
          Your payment is held for {holdDuration(protection.holdSeconds)} until you confirm
          delivery, then released to the merchant. Disputes are decided by {protection.arbiterLabel}
          ; if undecided, you're refunded.{" "}
          {protection.required
            ? "Connect the wallet you pay from to release or dispute later."
            : "Connect the wallet you pay from to turn it on."}
        </p>
      </details>
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

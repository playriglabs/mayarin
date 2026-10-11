import { useState } from "react";
import type { Protection, Rail } from "./types.ts";
import { chevron, errorText } from "./ui.ts";
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
  const [ineligible, setIneligible] = useState(false);
  if (!protectionApplies(protection, rail)) return null;

  async function connect() {
    setError("");
    setIneligible(false);
    try {
      const address = await connectWallet();
      // A wallet that keeps losing disputes no longer gets protection (#314).
      // Optional protection then simply stays off; required protection blocks.
      const response = await fetch(`/v1/payers/${address}/protection`);
      const { eligible } = response.ok
        ? ((await response.json()) as { eligible: boolean })
        : { eligible: true };
      if (!eligible) {
        setIneligible(true);
        return;
      }
      onPayerAddress(address);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to connect a wallet");
    }
  }

  // One line up front — what protection is, and the one action. The terms stay
  // on the page, one click away, so the card does not outweigh the pay button.
  return (
    <div className="mt-6 rounded-2xl border border-line bg-field/50 p-4">
      <div className="flex items-center gap-3">
        <ShieldIcon checked={payerAddress !== null} />
        <div className="min-w-0 flex-1 text-xs leading-relaxed text-muted">
          <p className="m-0">
            <span className="text-sm text-ink">Buyer protection</span>
            {!protection.required && payerAddress === null && " · optional"}
          </p>
          <p className="m-0">
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
          <button
            type="button"
            className="shrink-0 rounded-full border border-line bg-panel px-3.5 py-1.5 text-xs text-ink transition-colors hover:bg-field"
            onClick={() => void connect()}
          >
            Connect wallet
          </button>
        ) : (
          !protection.required && (
            <button
              type="button"
              className="ml-1 border-0 bg-transparent p-0 text-xs text-muted underline"
              onClick={() => onPayerAddress(null)}
            >
              Remove
            </button>
          )
        )}
      </div>
      <details className="group mt-3 border-t border-line pt-3">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
          How it works
          <span className={`${chevron} size-1.5 border-current rotate-45 group-open:-rotate-135`} />
        </summary>
        <p className="mt-2 mb-0 text-xs leading-relaxed text-muted">
          Your payment is held for {holdDuration(protection.holdSeconds)} until you confirm
          delivery, then released to the merchant. Disputes are decided by {protection.arbiterLabel}
          ; if undecided, you're refunded.{" "}
          {bondApplies(protection, rail) &&
            `Opening a dispute takes a bond of ${protection.bondBps / 100}% of the payment, returned if your claim holds and paid to the merchant if it doesn't. `}
          {protection.required
            ? "Connect the wallet you pay from to release or dispute later."
            : "Connect the wallet you pay from to turn it on."}
        </p>
      </details>
      {ineligible && (
        <p
          className={
            protection.required ? "mt-2 mb-0 text-sm text-danger" : "mt-2 mb-0 text-xs text-warning"
          }
          role="alert"
        >
          {protection.required
            ? "This payment requires buyer protection, which this wallet can no longer use."
            : "Buyer protection isn't available for this wallet. You can still pay — the merchant is paid directly."}
        </p>
      )}
      {error !== "" && (
        <p className={errorText} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** The shield, ticked once a wallet is attached. Also heads the escrow card. */
export function ShieldIcon({
  checked,
  className = "size-5 stroke-ink",
}: {
  readonly checked: boolean;
  readonly className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`shrink-0 fill-none ${className}`}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" />
      {checked && <path d="m8.5 12 2.5 2.5 4.5-5" />}
    </svg>
  );
}

/** Whether disputing costs a bond on this rail (#315): the merchant set one, on a v2 chain. */
function bondApplies(protection: Protection, rail: Rail | undefined): boolean {
  return protection.bondBps > 0 && rail !== undefined && protection.bondChains.includes(rail.chain);
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

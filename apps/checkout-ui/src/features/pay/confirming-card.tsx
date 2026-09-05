import { ChainLabel } from "../../shared/chain-logo.tsx";
import { walletAmount } from "../../shared/money.ts";
import type { Deposit } from "./types.ts";

/**
 * The moment the money arrives, the page must stop asking to be paid.
 *
 * This card replaces the deposit card — amount, QR, address, copy buttons all
 * leave — because every one of them invites a second transfer. `role="status"`
 * makes the transition audible to a screen reader without stealing focus.
 */
export function ConfirmingCard({ deposit }: { readonly deposit: Deposit }) {
  const received = walletAmount(deposit.received.formatted);

  return (
    <div className="preparing" role="status">
      <span className="spinner" aria-hidden="true" />
      <div>
        <h3>Payment detected</h3>
        <p>
          Your {deposit.amount.asset} arrived on <ChainLabel chain={deposit.chain} size={18} /> and
          is being confirmed. This takes a moment.
        </p>
        {deposit.received.amount !== "0" && (
          <p className="received-note">
            {received} {deposit.received.asset} received
          </p>
        )}
      </div>
    </div>
  );
}

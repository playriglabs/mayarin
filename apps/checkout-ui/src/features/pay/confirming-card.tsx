import { ChainLabel } from "../../shared/chain-logo.tsx";
import { walletAmount } from "../../shared/money.ts";
import { ProcessingArt } from "./illustrations.tsx";
import type { Deposit } from "./types.ts";

/**
 * The moment the money arrives, the page must stop asking to be paid.
 *
 * This replaces the deposit card — amount, QR, address, copy buttons all
 * leave — because every one of them invites a second transfer. `role="status"`
 * makes the transition audible to a screen reader without stealing focus.
 */
export function ConfirmingCard({
  deposit,
  intentId,
}: {
  readonly deposit: Deposit;
  readonly intentId: string;
}) {
  const received = walletAmount(deposit.received.formatted);

  return (
    <div className="state-view" role="status">
      <ProcessingArt />
      <h2>Payment processing</h2>
      <p>
        We received your {deposit.amount.asset} on <ChainLabel chain={deposit.chain} size={18} />{" "}
        and are confirming it. This usually takes under a minute.
      </p>
      {deposit.received.amount !== "0" && (
        <p className="received-note">
          {received} {deposit.received.asset} received
        </p>
      )}
      <p className="reference">
        Reference ID <code>{intentId}</code>
      </p>
    </div>
  );
}

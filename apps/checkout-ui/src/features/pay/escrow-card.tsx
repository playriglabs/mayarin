import { useCallback, useEffect, useState } from "react";
import { shortAddress } from "../../shared/buyer-protection.tsx";
import { connectWallet, sendCall } from "../../shared/wallet.ts";
import { DisputeThread } from "./dispute-thread.tsx";
import type { EscrowPayload } from "./types.ts";

/**
 * The hold on an escrowed payment (#304), on the paid page.
 *
 * Reads where the funds are from the chain, through the API, and lets the
 * payer release them or open a dispute from the wallet the terms name. The
 * factory decides whether that wallet may; this card only hides buttons that
 * would certainly revert.
 */
export function EscrowCard({ statusUrl }: { readonly statusUrl: string }) {
  const [escrow, setEscrow] = useState<EscrowPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`${statusUrl}/escrow`);
    if (!response.ok) return;
    setEscrow(((await response.json()) as { escrow: EscrowPayload }).escrow);
  }, [statusUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  if (escrow === null) return null;

  const releaseAfter = new Date(escrow.terms.releaseAfter);
  const holdOpen = Date.now() < releaseAfter.getTime();

  async function act(action: "release" | "dispute") {
    if (escrow === null || busy) return;
    setBusy(true);
    setError("");
    try {
      const from = await connectWallet();
      if (from.toLowerCase() !== escrow.terms.payer.toLowerCase()) {
        throw new Error(`Switch to the wallet you paid with, ${shortAddress(escrow.terms.payer)}.`);
      }
      // A v2 escrow with a bond pulls it on dispute (#315): approve it first.
      if (action === "dispute" && escrow.calls.approveBond !== null) {
        await sendCall({
          chainId: escrow.chainId,
          from,
          to: escrow.token,
          data: escrow.calls.approveBond,
        });
      }
      await sendCall({
        chainId: escrow.chainId,
        from,
        to: escrow.factory,
        data: escrow.calls[action],
      });
      // The transaction is sent, not mined; read again shortly after.
      setTimeout(() => void load(), 6_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The wallet refused the transaction");
    } finally {
      setBusy(false);
    }
  }

  const status =
    escrow.outcome === "released"
      ? "Released"
      : escrow.outcome === "split"
        ? "Split"
        : escrow.outcome === "refunded"
          ? "Refunded"
          : escrow.disputed
            ? "Disputed"
            : "Held";

  return (
    <div className="escrow-card" role="status">
      <div className="escrow-card-head">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="escrow-icon">
          <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" />
          <path d="m8.5 12 2.5 2.5 4.5-5" />
        </svg>
        <p className="section-kicker">Buyer protection</p>
        <span className={`escrow-status escrow-status-${status.toLowerCase()}`}>{status}</span>
      </div>

      <p className="escrow-when">
        {escrow.outcome === "released"
          ? "The payment went to the merchant."
          : escrow.outcome === "split"
            ? "The arbiter split the payment between you and the merchant."
            : escrow.outcome === "refunded"
              ? "The payment went back to your wallet."
              : escrow.disputed
                ? `Refunded to you if undecided by ${when(escrow.terms.resolveBy)}`
                : `Releases to the merchant on ${when(escrow.terms.releaseAfter)}`}
      </p>
      {escrow.outcome === "held" && (
        <p className="escrow-hint">
          {escrow.disputed
            ? escrow.terms.arbiter === ZERO_ADDRESS
              ? "The automatic release is stopped. The merchant can refund you."
              : "The automatic release is stopped. The arbiter decides, or the merchant refunds you."
            : holdOpen
              ? escrow.calls.approveBond === null
                ? "Got what you paid for? Release it now. Something wrong? Open a dispute first."
                : "Got what you paid for? Release it now. Something wrong? Open a dispute first — it takes the bond, returned if your claim holds."
              : "The hold has ended. It releases to the merchant shortly."}
        </p>
      )}

      {escrow.dispute !== null && (
        <DisputeThread
          statusUrl={statusUrl}
          payer={escrow.terms.payer}
          messages={escrow.dispute.messages}
          open={escrow.dispute.status === "open" && escrow.outcome === "held"}
          onPosted={() => void load()}
        />
      )}

      {escrow.outcome === "held" && (
        <div className="escrow-actions">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void act("release")}
          >
            Release payment
          </button>
          {holdOpen && !escrow.disputed && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void act("dispute")}
            >
              Open a dispute
            </button>
          )}
        </div>
      )}
      {error !== "" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** "Oct 3, 4:36 PM" — a date the payer reads at a glance. */
function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

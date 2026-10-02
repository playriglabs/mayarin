import { useCallback, useEffect, useState } from "react";
import { shortAddress } from "../../shared/buyer-protection.tsx";
import { connectWallet, sendCall } from "../../shared/wallet.ts";
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

  const headline =
    escrow.outcome === "released"
      ? "Released to the merchant"
      : escrow.outcome === "refunded"
        ? "Refunded to your wallet"
        : escrow.disputed
          ? "Held in escrow — disputed"
          : "Held in escrow";

  return (
    <div className="escrow-card" role="status">
      <p className="section-kicker">Buyer protection</p>
      <h3>{headline}</h3>
      {escrow.outcome === "held" && (
        <p>
          {escrow.disputed
            ? `The automatic release is stopped. ${
                escrow.terms.arbiter === ZERO_ADDRESS
                  ? ""
                  : "The arbiter decides, or the merchant refunds you; "
              }if nothing is decided by ${new Date(escrow.terms.resolveBy).toLocaleString()}, you are refunded.`
            : `Releases to the merchant automatically on ${releaseAfter.toLocaleString()}.`}
        </p>
      )}
      {escrow.outcome === "held" && (
        <div className="escrow-actions">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void act("release")}
          >
            Release to merchant
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

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

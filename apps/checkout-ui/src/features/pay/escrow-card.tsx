import { useCallback, useEffect, useState } from "react";
import { ShieldIcon, shortAddress } from "../../shared/buyer-protection.tsx";
import { errorText, primaryButton, secondaryButton } from "../../shared/ui.ts";
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

  // With an open dispute, the release sits beside "Sign and send" in the thread.
  const threadOpen =
    escrow.dispute !== null && escrow.dispute.status === "open" && escrow.outcome === "held";
  const releaseButton = (
    <button
      type="button"
      className={primaryButton}
      disabled={busy}
      onClick={() => void act("release")}
    >
      Release payment
    </button>
  );

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

  const headline =
    escrow.outcome === "released"
      ? "Paid to the merchant"
      : escrow.outcome === "split"
        ? "Split by the arbiter"
        : escrow.outcome === "refunded"
          ? "Refunded to your wallet"
          : escrow.disputed
            ? `Refunded to you if undecided by ${when(escrow.terms.resolveBy)}`
            : `Releases to the merchant on ${when(escrow.terms.releaseAfter)}`;

  const note =
    escrow.outcome !== "held"
      ? undefined
      : escrow.disputed
        ? escrow.terms.arbiter === ZERO_ADDRESS
          ? "The automatic release is stopped. The merchant can refund you."
          : "The automatic release is stopped. The arbiter decides, or the merchant refunds you."
        : holdOpen
          ? escrow.calls.approveBond === null
            ? "Got what you paid for? Release it now. Something wrong? Open a dispute first."
            : "Got what you paid for? Release it now. Something wrong? Open a dispute first. It takes a bond, returned if your claim holds."
          : "The hold has ended. It releases to the merchant shortly.";

  // Laid out like the buyer-protection card the payer saw before paying: the
  // shield, one line of what it is, one of where the money is. What to do next
  // sits under a hairline, the way "How it works" does there.
  return (
    <div
      className="mt-6 w-full rounded-2xl border border-line bg-field/50 p-4 text-left"
      role="status"
    >
      <div className="flex items-center gap-3">
        <ShieldIcon checked />
        <div className="min-w-0 flex-1 text-xs leading-relaxed text-muted">
          <p className="m-0 text-sm text-ink">Buyer protection</p>
          <p className="m-0">{headline}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
          <span className={`size-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden="true" />
          {status}
        </span>
      </div>

      {/* With a dispute, the note heads the thread instead: one block, one hairline. */}
      {note !== undefined && escrow.dispute === null && (
        <p className="mt-3 mb-0 border-t border-line pt-3 text-xs leading-relaxed text-muted">
          {note}
        </p>
      )}

      {escrow.dispute !== null && (
        <DisputeThread
          statusUrl={statusUrl}
          payer={escrow.terms.payer}
          note={note}
          messages={escrow.dispute.messages}
          open={threadOpen}
          onPosted={() => void load()}
          release={threadOpen ? releaseButton : undefined}
          reference={escrow.dispute.reference}
        />
      )}

      {escrow.outcome === "held" && !threadOpen && (
        <div className="mt-4 grid grid-cols-2 gap-2.5 [&>*:only-child]:col-span-2">
          {releaseButton}
          {holdOpen && !escrow.disputed && (
            <button
              type="button"
              className={secondaryButton}
              disabled={busy}
              onClick={() => void act("dispute")}
            >
              Open a dispute
            </button>
          )}
        </div>
      )}

      {error !== "" && (
        <p className={errorText} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Held is waiting (amber), disputed needs attention (red), released is done. */
const STATUS_DOT: Record<string, string> = {
  Held: "bg-warning",
  Disputed: "bg-danger",
  Released: "bg-brand",
  Split: "bg-brand",
  Refunded: "bg-subtle",
};

/** "Oct 3, 4:36 PM" — a date the payer reads at a glance. */
function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

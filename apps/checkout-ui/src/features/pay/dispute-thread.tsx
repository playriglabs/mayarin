import { type ReactNode, useEffect, useRef, useState } from "react";
import { shortAddress } from "../../shared/buyer-protection.tsx";
import { connectWallet, signMessage } from "../../shared/wallet.ts";
import type { DisputeMessage } from "./types.ts";

const AUTHOR_LABELS: Readonly<Record<DisputeMessage["author"], string>> = {
  payer: "You",
  merchant: "Merchant",
  arbiter: "Mayarin Resolution",
};

/**
 * The payer's side of a dispute (#313): the thread, and a box to explain what
 * went wrong. Checkout has no session, so each message is signed by the wallet
 * the escrow refunds to — the text signed matches the API's, which binds it to
 * this payment and this minute.
 */
export function DisputeThread({
  statusUrl,
  payer,
  messages,
  open,
  onPosted,
  release,
  reference,
}: {
  readonly statusUrl: string;
  readonly payer: string;
  readonly messages: readonly DisputeMessage[];
  readonly open: boolean;
  readonly onPosted: () => void;
  /** The escrow's release button, laid out beside "Sign and send" in one row. */
  readonly release?: ReactNode;
  /** The dispute's number, to quote when contacting support. */
  readonly reference: string;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const asked = messages.some((message) => message.author === "payer");
  const list = useRef<HTMLOListElement>(null);

  // The thread scrolls inside a fixed height; keep the newest message in view.
  useEffect(() => {
    const element = list.current;
    if (element !== null && messages.length > 0) element.scrollTop = element.scrollHeight;
  }, [messages.length]);

  async function send() {
    const body = draft.trim();
    if (body === "" || busy) return;
    setBusy(true);
    setError("");
    try {
      const from = await connectWallet();
      if (from.toLowerCase() !== payer.toLowerCase()) {
        throw new Error(`Switch to the wallet you paid with, ${shortAddress(payer)}.`);
      }
      const paymentId = statusUrl.slice(statusUrl.lastIndexOf("/") + 1);
      const signedAt = new Date().toISOString();
      const signature = await signMessage(
        from,
        `Mayarin dispute message\nPayment: ${paymentId}\nSigned at: ${signedAt}\n\n${body}`,
      );
      const response = await fetch(`${statusUrl}/escrow/dispute/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, signedAt, signature }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(failure?.error?.message ?? "The message was not sent");
      }
      setDraft("");
      onPosted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The message was not sent");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dispute-thread">
      <p className="dispute-reference">
        Dispute <strong>#{reference}</strong>. The merchant sees this thread and can answer here or
        refund you directly; quote the number if you contact support.
      </p>
      {messages.length > 0 && (
        <ol ref={list}>
          {messages.map((message) => (
            <li key={message.id} className={`dispute-message dispute-message-${message.author}`}>
              <span className="dispute-author">{AUTHOR_LABELS[message.author]}</span>
              <p>{message.body}</p>
            </li>
          ))}
        </ol>
      )}
      {open && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label className="dispute-label" htmlFor="dispute-draft">
            {asked ? "Add to your case" : "Tell the arbiter what went wrong"}
          </label>
          <textarea
            id="dispute-draft"
            value={draft}
            maxLength={2000}
            rows={3}
            placeholder="What you ordered, what arrived, and any links or tracking."
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="dispute-actions">
            <button type="submit" className="secondary" disabled={busy || draft.trim() === ""}>
              {busy ? "Signing…" : "Sign and send"}
            </button>
            {release}
          </div>
          {error !== "" && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

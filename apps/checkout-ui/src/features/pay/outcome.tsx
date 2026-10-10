import { footnote, stateText, stateTitle, stateView } from "../../shared/ui.ts";
import { EscrowCard } from "./escrow-card.tsx";
import { ExpiredArt, FailedArt, SuccessArt } from "./illustrations.tsx";

/** A page with folded corner and text lines — the invoice. */
const DOCUMENT_ICON = "block size-4 shrink-0 fill-none stroke-current";

function InvoiceIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={DOCUMENT_ICON}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </svg>
  );
}

/** A torn-edge slip with a tick — the receipt, proof it was paid. */
function ReceiptIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={DOCUMENT_ICON}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5-2 1.5-2.5-1.5L5 21z" />
      <path d="m9 11 2 2 4-4" />
    </svg>
  );
}

/**
 * The end of the payment, in place of the deposit card.
 *
 * A finished payment must stop asking to be paid. Leaving the QR and address on
 * screen invites a second transfer to an address that will not clear it — the
 * same mistake in the failed and expired case as in the paid one, so all three
 * replace the card rather than only the happy path.
 */
export function Outcome({
  status,
  intentId,
  statusUrl,
  merchantName,
  escrowed,
}: {
  readonly status: string;
  /** The payment settled into escrow (#304): the merchant is not paid yet. */
  readonly escrowed: boolean;
  readonly intentId: string;
  /** Who to contact when a payment did not go through. */
  readonly merchantName: string;
  /** The payment's own URL; its invoice and receipt PDFs sit under it (#293). */
  readonly statusUrl: string;
}) {
  const paid = status === "COMPLETED";
  const expired = status === "EXPIRED";
  const heading = paid ? "Payment completed" : expired ? "Payment expired" : "Payment failed";
  // Deliberately not the engine's own failure reason: that string names
  // clearing transactions and executor attempts — a sentence for an operator
  // reading the dashboard, not for the person holding the phone.
  const note = paid
    ? escrowed
      ? "Your payment is held in escrow until you release it or the hold ends."
      : "The merchant has been paid. You can safely close this page."
    : expired
      ? "The time to pay ran out before a payment arrived. Start a new payment to try again."
      : "Start a new payment to try again.";

  const documentLink =
    "inline-flex items-center justify-center gap-2 rounded-full border border-line px-3 py-2.5 text-sm text-ink no-underline transition-colors hover:bg-field";

  return (
    <div className={stateView} role="status">
      {paid ? <SuccessArt /> : expired ? <ExpiredArt /> : <FailedArt />}
      <h2 className={stateTitle}>{heading}</h2>
      <p className={stateText}>{note}</p>
      {paid && escrowed && <EscrowCard statusUrl={statusUrl} />}
      {paid && (
        <div className="mt-6 grid w-full max-w-sm grid-cols-2 gap-2.5">
          <a href={`${statusUrl}/invoice.pdf`} download className={documentLink}>
            <InvoiceIcon />
            Download invoice
          </a>
          <a href={`${statusUrl}/receipt.pdf`} download className={documentLink}>
            <ReceiptIcon />
            Download receipt
          </a>
        </div>
      )}
      {!paid && (
        // A payer who already sent funds needs someone to talk to, and the
        // reference is what either side will ask for first.
        <p className="mt-5 mb-0 max-w-sm rounded-2xl border border-line bg-field/50 px-4 py-3 text-xs leading-relaxed text-muted">
          Already sent funds? We recommend contacting {merchantName} or your wallet or exchange
          provider&apos;s customer service, and sharing the Reference ID below.
        </p>
      )}
      <p className={`${footnote} mt-6`}>
        Reference ID <code>{intentId}</code>
      </p>
    </div>
  );
}

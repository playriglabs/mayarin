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
}: {
  readonly status: string;
  readonly intentId: string;
}) {
  const paid = status === "COMPLETED";
  const heading = paid
    ? "Payment completed"
    : status === "EXPIRED"
      ? "Payment expired"
      : "Payment failed";
  // Deliberately not the engine's own failure reason: that string names
  // clearing transactions and executor attempts — a sentence for an operator
  // reading the dashboard, not for the person holding the phone.
  const note = paid
    ? "Thank you. You can safely close this page."
    : "Start a new payment to try again.";

  return (
    <div className="outcome-wrap">
      <div className="outcome">
        <div className={`mark${paid ? "" : " bad"}`}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            {paid ? (
              <path
                d="M2 8.5 L6.5 13 L14 3"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="square"
              />
            ) : (
              <path
                d="M3 3 L13 13 M13 3 L3 13"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="square"
              />
            )}
          </svg>
        </div>
        <h2>{heading}</h2>
        <p className="pt-2">{note}</p>
        <p className="reference">
          Reference ID <code>{intentId}</code>
        </p>
      </div>
    </div>
  );
}

import { ExpiredArt, FailedArt, SuccessArt } from "./illustrations.tsx";

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
  const expired = status === "EXPIRED";
  const heading = paid ? "Payment completed" : expired ? "Payment expired" : "Payment failed";
  // Deliberately not the engine's own failure reason: that string names
  // clearing transactions and executor attempts — a sentence for an operator
  // reading the dashboard, not for the person holding the phone.
  const note = paid
    ? "The merchant has been paid. You can safely close this page."
    : expired
      ? "The time to pay ran out before a payment arrived. Start a new payment to try again."
      : "Start a new payment to try again.";

  return (
    <div className="state-view" role="status">
      {paid ? <SuccessArt /> : expired ? <ExpiredArt /> : <FailedArt />}
      <h2>{heading}</h2>
      <p>{note}</p>
      <p className="reference">
        Reference ID <code>{intentId}</code>
      </p>
    </div>
  );
}

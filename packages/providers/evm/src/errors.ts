/**
 * Turning a viem error into one line.
 *
 * viem's messages are written for a developer holding a stack trace: the short
 * cause, then the request arguments, then the docs URL, then the version, then
 * the raw body. Thirty lines. Two places make that a problem rather than a
 * nuisance:
 *
 * - **A log.** A rate-limited watcher printing thirty lines per pass reads as a
 *   crash, and the one line that says what happened is buried in the middle.
 * - **A failure reason.** It is stored on the payment and shown to a merchant.
 *   `Nonce provided for the transaction (138) is lower than…` followed by
 *   calldata is not something anyone can act on, and it is what the merchant
 *   sees where an explanation should be.
 *
 * So the message is reduced here, at the boundary where viem errors are born,
 * rather than trimmed at each place one might surface.
 */

const MAX_LENGTH = 200;

/**
 * The shortest true statement of what went wrong.
 *
 * viem exposes `shortMessage` — the first line, without the argument dump — on
 * every error it defines. Anything else falls back to the message, cut at a
 * length a log line and a database column can both live with.
 */
export function shortReason(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);

  const short = (error as { shortMessage?: unknown }).shortMessage;
  if (typeof short === "string" && short.length > 0) return truncate(short);

  const details = (error as { details?: unknown }).details;
  if (typeof details === "string" && details.length > 0) return truncate(details);

  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return "Unknown error";

  // Everything from viem's first structured section onwards is argument dump.
  // Cutting at the marker keeps the sentence and drops the transcript.
  const [first = message] = message.split(/\n\n|\nRequest Arguments:|\nDetails:|\nVersion:/);
  return truncate(first.trim());
}

function truncate(value: string): string {
  return value.length <= MAX_LENGTH ? value : `${value.slice(0, MAX_LENGTH - 1)}…`;
}

/**
 * A transaction hash, shortened, linked to the chain's explorer when there is
 * one to link to.
 *
 * `transactionExplorerUrl` returns nothing for an unsupported chain or for a
 * reference that is not a hash at all — a mock provider's reference, for
 * instance — so this falls back to plain text rather than rendering a link that
 * goes nowhere. Either way the full hash stays in the `title`, because the
 * shortened form is for reading and the whole one is for copying.
 */

import { shortHash, transactionExplorerUrl } from "@mayarin/chain";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";

function TransactionLink({
  chain,
  transactionHash,
}: {
  readonly chain: string;
  readonly transactionHash: string;
}) {
  const explorer = transactionExplorerUrl(chain, transactionHash);

  if (explorer === undefined) {
    return (
      <span title={transactionHash} className="font-mono text-muted-foreground text-xs">
        {shortHash(transactionHash)}
      </span>
    );
  }

  return (
    <a
      href={explorer}
      target="_blank"
      rel="noreferrer"
      title={transactionHash}
      className="inline-flex items-center gap-1 font-mono text-foreground text-xs underline decoration-input underline-offset-2 hover:decoration-foreground"
    >
      {shortHash(transactionHash)}
      <ArrowSquareOutIcon size={12} aria-hidden="true" />
    </a>
  );
}

export { TransactionLink };

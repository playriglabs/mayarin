import { useEffect, useState } from "react";

/** Which of the two values a payer must reproduce in a wallet was just copied. */
export type CopyTarget = "amount" | "address";

export interface Copier {
  readonly copied: CopyTarget | undefined;
  readonly copy: (target: CopyTarget, text: string) => void;
}

/**
 * Copy, with a confirmation that reverts on its own — so the button reads as
 * an action again rather than as a permanent state.
 */
export function useCopy(): Copier {
  const [copied, setCopied] = useState<CopyTarget | undefined>(undefined);

  useEffect(() => {
    if (copied === undefined) return;
    const timer = setTimeout(() => setCopied(undefined), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = (target: CopyTarget, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(target);
  };

  return { copied, copy };
}

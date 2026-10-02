import type { ReactNode } from "react";

/** One key/value line. Rendered inside a `<dl>` so the pairing is real. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-b-0">
      <dt className="shrink-0 text-sm text-foreground/50">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-foreground">{children}</dd>
    </div>
  );
}

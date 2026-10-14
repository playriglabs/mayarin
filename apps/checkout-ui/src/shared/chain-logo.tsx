import { chainLabel, chainLogoUrl } from "@mayarin/chain";
import arcLogo from "./arc.svg";

/**
 * Sized in `em` by default, because the same label sits standalone in a rail
 * row and inline inside small prose: a fixed 18px mark inflates a 12px line.
 */
export function ChainLogo({
  chain,
  size = 22,
  className = "size-[1.15em]",
}: {
  readonly chain: string;
  readonly size?: number;
  readonly className?: string;
}) {
  const source = chainLogoUrl(chain, arcLogo);
  if (source === undefined) return null;
  return (
    <img
      className={`shrink-0 rounded-full object-contain ${className}`}
      src={source}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      decoding="async"
    />
  );
}

/** The mark and the name, kept on one line and dropped onto the sentence's baseline. */
export function ChainLabel({
  chain,
  size = 22,
}: {
  readonly chain: string;
  readonly size?: number;
}) {
  return (
    <span className="inline-flex items-center gap-[0.35em] align-[-0.25em] whitespace-nowrap">
      <ChainLogo chain={chain} size={size} />
      <span>{chainLabel(chain)}</span>
    </span>
  );
}

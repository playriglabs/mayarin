import { chainLabel, chainLogoUrl } from "@mayarin/chain";
import { cn } from "@/lib/utils";

function ChainLogo({
  chain,
  size = 22,
  className,
}: {
  readonly chain: string;
  readonly size?: number;
  readonly className?: string;
}) {
  const source = chainLogoUrl(chain);
  if (source === undefined) return null;
  return (
    <img
      src={source}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      decoding="async"
      className={cn("shrink-0 rounded-full object-contain", className)}
    />
  );
}

function ChainLabel({
  chain,
  size = 22,
  className,
}: {
  readonly chain: string;
  readonly size?: number;
  readonly className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <ChainLogo chain={chain} size={size} />
      <span>{chainLabel(chain)}</span>
    </span>
  );
}

export { ChainLabel, ChainLogo };

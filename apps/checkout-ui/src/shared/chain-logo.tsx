import { chainLabel, chainLogoUrl } from "@mayarin/chain";
import arcLogo from "./arc.svg";

export function ChainLogo({
  chain,
  size = 22,
}: {
  readonly chain: string;
  readonly size?: number;
}) {
  const source = chainLogoUrl(chain, arcLogo);
  if (source === undefined) return null;
  return (
    <img
      className="chain-logo"
      src={source}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      decoding="async"
    />
  );
}

export function ChainLabel({
  chain,
  size = 22,
}: {
  readonly chain: string;
  readonly size?: number;
}) {
  return (
    <span className="chain-label">
      <ChainLogo chain={chain} size={size} />
      <span>{chainLabel(chain)}</span>
    </span>
  );
}

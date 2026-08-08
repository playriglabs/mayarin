/**
 * Endpoint URL policy (RFC #13).
 *
 * A webhook endpoint is a URL this system will POST signed payment facts to,
 * so registration is the SSRF boundary: HTTPS only, and never a
 * private-network destination. The literal checks live here; the composition
 * layer must also resolve the hostname and pass every resolved address to
 * `isPrivateAddress`, because a public name can point anywhere.
 */

import { ValidationError } from "@mayarin/shared";

/** Throws unless `url` is HTTPS with a hostname that is not a literal private address. */
export function assertWebhookUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError("url must be a valid URL");
  }

  if (parsed.protocol !== "https:") {
    throw new ValidationError("url must use https");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new ValidationError("url must not carry credentials");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new ValidationError("url must not point at a private network");
  }
  if (isPrivateAddress(hostname)) {
    throw new ValidationError("url must not point at a private network");
  }

  return parsed;
}

/**
 * Whether an IP literal is loopback, private, link-local or otherwise
 * non-routable. A hostname that is not an IP literal returns false — resolve
 * it first and check every address.
 */
export function isPrivateAddress(address: string): boolean {
  const v4 = parseIpv4(address);
  if (v4 !== undefined) {
    const [a, b] = v4;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true;
    return false;
  }

  if (!address.includes(":")) return false;
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  // fc00::/7 (unique local), fe80::/10 (link local).
  if (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8")) return true;
  // IPv4-mapped, in either spelling: `::ffff:127.0.0.1`, or the hex form
  // `::ffff:7f00:1` that URL parsing normalises the dotted one into.
  const mapped = lower.match(/^::ffff:(.+)$/);
  if (mapped?.[1] !== undefined) {
    const rest = mapped[1];
    if (rest.includes(".")) return isPrivateAddress(rest);
    const groups = rest.split(":");
    if (groups.length > 2) return false;
    const hi = groups.length === 2 ? Number.parseInt(groups[0] ?? "", 16) : 0;
    const lo = Number.parseInt(groups[groups.length - 1] ?? "", 16);
    if (!Number.isInteger(hi) || !Number.isInteger(lo)) return false;
    return isPrivateAddress(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  return false;
}

function parseIpv4(address: string): readonly number[] | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return octets.every((octet) => Number.isInteger(octet) && octet <= 255) ? octets : undefined;
}

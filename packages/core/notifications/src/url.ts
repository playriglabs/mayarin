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
  // An empty port is 443. Anything else lets a receiver URL name an internal
  // service's port on an address that passed the host check.
  if (parsed.port !== "" && parsed.port !== "443") {
    throw new ValidationError("url must use port 443");
  }

  // A trailing dot is the same name: `localhost.` is `localhost`.
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new ValidationError("url must not point at a private network");
  }
  if (isPrivateAddress(hostname)) {
    throw new ValidationError("url must not point at a private network");
  }

  return parsed;
}

/**
 * Whether an IP literal is loopback, private, link-local, multicast, reserved
 * or otherwise not a public unicast address. A hostname that is not an IP
 * literal returns false — resolve it first and check every address.
 */
export function isPrivateAddress(address: string): boolean {
  const v4 = parseIpv4(address);
  if (v4 !== undefined) return isPrivateIpv4(v4);

  const groups = parseIpv6(address);
  if (groups === undefined) return false;
  return isPrivateIpv6(groups);
}

function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a = 0, b = 0, c = 0] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 169 && b === 254) return true; // link local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // documentation
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // documentation
  if (a === 203 && b === 0 && c === 113) return true; // documentation
  return a >= 224; // multicast, reserved, broadcast
}

function isPrivateIpv6(groups: readonly number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const embedded = [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff];

  // `::` and `::1`.
  if (groups.slice(0, 7).every((group) => group === 0) && g7 <= 1) return true;
  // IPv4-mapped `::ffff:a.b.c.d` and the deprecated IPv4-compatible `::a.b.c.d`.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    return isPrivateIpv4(embedded);
  }
  // NAT64 `64:ff9b::/96` carries an IPv4 address in its last 32 bits.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPrivateIpv4(embedded);
  }
  // 6to4 `2002::/16` embeds the IPv4 address in bits 16..47.
  if (g0 === 0x2002) return isPrivateIpv4([g1 >> 8, g1 & 0xff, g2 >> 8, g2 & 0xff]);
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site local (deprecated)
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // discard-only
  return false;
}

function parseIpv4(address: string): readonly number[] | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return octets.every((octet) => Number.isInteger(octet) && octet <= 255) ? octets : undefined;
}

/** Eight 16-bit groups, however the address was abbreviated; undefined if it is not IPv6. */
function parseIpv6(address: string): readonly number[] | undefined {
  const zone = address.indexOf("%");
  const text = (zone === -1 ? address : address.slice(0, zone)).toLowerCase();
  if (!text.includes(":")) return undefined;

  // A trailing dotted quad stands for the last two groups.
  let tail: number[] = [];
  let body = text;
  const lastColon = text.lastIndexOf(":");
  const dotted = text.slice(lastColon + 1);
  if (dotted.includes(".")) {
    const octets = parseIpv4(dotted);
    if (octets === undefined) return undefined;
    tail = [((octets[0] ?? 0) << 8) | (octets[1] ?? 0), ((octets[2] ?? 0) << 8) | (octets[3] ?? 0)];
    body = text.slice(0, lastColon + 1) + (tail.length > 0 ? "0:0" : "");
  }

  const halves = body.split("::");
  if (halves.length > 2) return undefined;
  const toGroups = (part: string): number[] | undefined => {
    if (part === "") return [];
    const groups = part
      .split(":")
      .map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN));
    return groups.every(Number.isInteger) ? groups : undefined;
  };
  const head = toGroups(halves[0] ?? "");
  const rest = halves.length === 2 ? toGroups(halves[1] ?? "") : [];
  if (head === undefined || rest === undefined) return undefined;

  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return undefined;
    groups = [...head, ...Array<number>(missing).fill(0), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return undefined;
  if (tail.length === 2) groups = [...groups.slice(0, 6), ...tail];
  return groups;
}

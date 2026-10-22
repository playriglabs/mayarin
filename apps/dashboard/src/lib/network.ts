/**
 * Which network this dashboard deployment is for, from the Worker's `NETWORK` var
 * (`wrangler.jsonc` for testnet; `scripts/deploy-cloudflare-mainnet.ts` writes `mainnet`).
 *
 * Anything but exactly "mainnet" is a testnet: a deployment that loses the variable keeps
 * the warning instead of dropping it. Server side only (`astro:env/server`); a React island
 * gets the value as a prop and its words from `network-copy.ts`.
 */

import { getSecret } from "astro:env/server";
import type { Network } from "./network-copy";

export function getNetwork(): Network {
  return getSecret("NETWORK") === "mainnet" ? "mainnet" : "testnet";
}

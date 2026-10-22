/**
 * What the account pages say about the network they are on.
 *
 * Kept apart from `network.ts` on purpose: that module reads the Worker's env through
 * `astro:env/server`, which must never reach a React island's bundle. This one is pure,
 * so the register form can import it and a test can pin it.
 */

export type Network = "testnet" | "mainnet";

export interface RegisterCopy {
  readonly title: string;
  readonly intro: string;
}

export function registerCopy(network: Network): RegisterCopy {
  return network === "mainnet"
    ? {
        title: "Create your account",
        intro: "Price in your own currency, settle in a stablecoin.",
      }
    : {
        title: "Create your sandbox account",
        intro:
          "This is a testing environment. Transactions use test assets and have no real-world value.",
      };
}

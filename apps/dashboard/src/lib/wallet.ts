/**
 * The browser's own wallet, reached directly (#11).
 *
 * Proving control of an address is a signature over a message this deployment
 * issued. The merchant's wallet is right there in the page, so asking them to
 * copy a message into a console and paste a hex string back is a step that
 * exists only because nobody wrote this file.
 *
 * No wallet library. The two calls needed — "who are you" and "sign this" — are
 * EIP-1193 requests, and a connect-kit would bring a provider registry, a chain
 * switcher and a modal for a page that wants one signature.
 *
 * Discovery is EIP-6963 with `window.ethereum` behind it. 6963 is what makes
 * two installed wallets distinguishable rather than whichever one won the race
 * to overwrite `window.ethereum`; the fallback is for wallets that never
 * announce.
 *
 * **Every announced wallet is returned, and the merchant picks.** Taking the
 * first one is taking whichever extension answered fastest — on a browser with
 * its own built-in wallet that is reliably the one the merchant does not use.
 */

/** The slice of EIP-1193 this uses. Anything wider would be a signing surface. */
export interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
}

export interface InjectedWallet {
  readonly name: string;
  /** A data URI the wallet announced. Absent for a legacy `window.ethereum`. */
  readonly icon: string | undefined;
  readonly provider: Eip1193Provider;
}

interface AnnounceProviderEvent extends Event {
  readonly detail?: {
    readonly info?: {
      readonly name?: string;
      readonly uuid?: string;
      readonly icon?: string;
      readonly rdns?: string;
    };
    readonly provider?: Eip1193Provider;
  };
}

/**
 * Wallets this browser has, announced or injected.
 *
 * Resolves after a short window rather than on the first announcement: wallets
 * answer independently, and returning the first one back would pick by timing.
 */
export function discoverWallets(timeoutMs = 150): Promise<readonly InjectedWallet[]> {
  if (typeof window === "undefined") return Promise.resolve([]);

  return new Promise((resolve) => {
    const found = new Map<string, InjectedWallet>();

    const onAnnounce = (event: Event) => {
      const detail = (event as AnnounceProviderEvent).detail;
      const provider = detail?.provider;
      if (provider === undefined) return;
      const key = detail?.info?.rdns ?? detail?.info?.uuid ?? String(found.size);
      found.set(key, {
        name: detail?.info?.name ?? "Injected wallet",
        icon: detail?.info?.icon,
        provider,
      });
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      if (found.size === 0) {
        const legacy = (window as { ethereum?: Eip1193Provider }).ethereum;
        if (legacy !== undefined) {
          found.set("legacy", { name: "Browser wallet", icon: undefined, provider: legacy });
        }
      }
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

/**
 * The account the merchant selected, lowercased.
 *
 * Lowercased because that is how every address is stored and compared here; a
 * checksummed string from the wallet would fail an equality check against a row
 * that is the same address.
 */
export async function requestAccount(provider: Eip1193Provider): Promise<string> {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const first = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof first !== "string") throw new Error("The wallet returned no account");
  return first.toLowerCase();
}

/**
 * Signs the verification message.
 *
 * `personal_sign` takes `[message, address]` in that order — reversed, wallets
 * either refuse or sign the address as the message, and the recovered address
 * is then somebody else's.
 */
export async function personalSign(
  provider: Eip1193Provider,
  address: string,
  message: string,
): Promise<string> {
  const signature = await provider.request({ method: "personal_sign", params: [message, address] });
  if (typeof signature !== "string") throw new Error("The wallet returned no signature");
  return signature;
}

/**
 * Puts the wallet on the payout's chain (#295). A transaction sent on the wrong
 * network would call whatever sits at the Safe's address there — usually
 * nothing, and the gas is spent anyway.
 */
export async function switchChain(provider: Eip1193Provider, chainId: bigint): Promise<void> {
  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: `0x${chainId.toString(16)}` }],
  });
}

/**
 * Sends one transaction the backend prepared and returns its hash (#295).
 *
 * The merchant's wallet shows them what it is about to sign; Mayarin never
 * holds the key that signs it.
 */
export async function sendTransaction(
  provider: Eip1193Provider,
  transaction: { readonly from: string; readonly to: string; readonly data: string },
): Promise<string> {
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [{ from: transaction.from, to: transaction.to, data: transaction.data, value: "0x0" }],
  });
  if (typeof hash !== "string") throw new Error("The wallet returned no transaction hash");
  return hash;
}

/** A 20-byte address as one ABI word. */
function word(address: string): string {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

/**
 * How much of `token` the `owner` lets `spender` move, read through the wallet's
 * own RPC — so a payout asks for an approval only when the allowance is short.
 */
export async function readAllowance(
  provider: Eip1193Provider,
  token: string,
  owner: string,
  spender: string,
): Promise<bigint> {
  // allowance(address,address)
  const data = `0xdd62ed3e${word(owner)}${word(spender)}`;
  const result = await provider.request({
    method: "eth_call",
    params: [{ to: token, data }, "latest"],
  });
  return typeof result === "string" && result !== "0x" ? BigInt(result) : 0n;
}

/**
 * Waits until the chain has a receipt for `hash`, and fails on a revert. An
 * approval must be mined before the payout that spends it is sent, or the
 * payout's own simulation sees no allowance.
 */
export async function waitForReceipt(
  provider: Eip1193Provider,
  hash: string,
  { attempts = 60, intervalMs = 2_000 } = {},
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })) as { readonly status?: string } | null;
    if (receipt != null) {
      if (receipt.status === "0x1") return;
      throw new Error("The transaction reverted");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("The transaction was not confirmed in time");
}

/**
 * What went wrong, in the wallet's own words where it has any.
 *
 * A user closing the wallet's prompt is `4001`, and it is not an error worth
 * showing as one — they made a decision.
 */
export function walletErrorMessage(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 4001) return undefined;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : "The wallet refused that request";
}

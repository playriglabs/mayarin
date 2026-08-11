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

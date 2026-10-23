/**
 * The browser wallet, through EIP-1193 and nothing else.
 *
 * The hosted page pays by deposit and needs no wallet for that. An escrowed
 * payment (#304) needs one twice: to learn the payer's address before the
 * price lock, and later to release or dispute. Both are a couple of RPC calls,
 * so no wallet library is pulled in for them.
 */

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function provider(): Eip1193 {
  const injected = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  if (injected === undefined) {
    throw new Error("No browser wallet found. Install MetaMask or open this page in a wallet.");
  }
  return injected;
}

/** Whether this browser has a wallet to ask: false on a phone paying from another app, and on a server render. */
export function hasWallet(): boolean {
  return (
    typeof window !== "undefined" &&
    (window as unknown as { ethereum?: Eip1193 }).ethereum !== undefined
  );
}

/** Asks the wallet for the payer's address. */
export async function connectWallet(): Promise<string> {
  const accounts = (await provider().request({ method: "eth_requestAccounts" })) as string[];
  const account = accounts[0];
  if (account === undefined) throw new Error("The wallet returned no account.");
  return account;
}

/**
 * Switches to `chainId`, sends one call, and resolves once it is mined.
 *
 * The chain is read again after the switch: Phantom can accept
 * `wallet_switchEthereumChain` without moving, and the factory sits at the same
 * address on every chain, so the call would land, or revert, on another one.
 * Waiting for the receipt is what lets the caller read the escrow afterwards
 * and see the change, and lets a bond approval land before the dispute.
 */
export async function sendCall(call: {
  readonly chainId: string;
  readonly from: string;
  readonly to: string;
  readonly data: string;
}): Promise<string> {
  const wallet = provider();
  const chainId = `0x${BigInt(call.chainId).toString(16)}`;
  // Switch only when needed: a switch prompt followed at once by a send prompt
  // has broken MetaMask's confirmation window ("reading 'origin'").
  const current = (await wallet.request({ method: "eth_chainId" })) as string;
  if (BigInt(current) !== BigInt(chainId)) {
    await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    const switched = (await wallet.request({ method: "eth_chainId" })) as string;
    if (BigInt(switched) !== BigInt(chainId)) {
      throw new Error(
        `Your wallet is on another network. Switch it to chain ${BigInt(chainId)} and try again.`,
      );
    }
  }
  const hash = (await wallet.request({
    method: "eth_sendTransaction",
    params: [{ from: call.from, to: call.to, data: call.data, chainId }],
  })) as string;
  await waitForReceipt(wallet, hash);
  return hash;
}

/** Polls the wallet's node until `hash` is mined; throws if it reverted. */
async function waitForReceipt(wallet: Eip1193, hash: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const receipt = (await wallet.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })) as { status: string } | null;
    if (receipt !== null) {
      if (BigInt(receipt.status) !== 1n) throw new Error("The transaction reverted on chain.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error("The transaction is still pending. Refresh this page in a minute.");
}

/** Signs `message` with `from` (`personal_sign`); resolves with the signature. */
export async function signMessage(from: string, message: string): Promise<string> {
  const hex = `0x${Array.from(new TextEncoder().encode(message), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
  return (await provider().request({ method: "personal_sign", params: [hex, from] })) as string;
}

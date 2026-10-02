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

/** Asks the wallet for the payer's address. */
export async function connectWallet(): Promise<string> {
  const accounts = (await provider().request({ method: "eth_requestAccounts" })) as string[];
  const account = accounts[0];
  if (account === undefined) throw new Error("The wallet returned no account.");
  return account;
}

/** Switches to `chainId` and sends one call; resolves with the transaction hash. */
export async function sendCall(call: {
  readonly chainId: string;
  readonly from: string;
  readonly to: string;
  readonly data: string;
}): Promise<string> {
  const wallet = provider();
  await wallet.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: `0x${BigInt(call.chainId).toString(16)}` }],
  });
  return (await wallet.request({
    method: "eth_sendTransaction",
    params: [{ from: call.from, to: call.to, data: call.data }],
  })) as string;
}

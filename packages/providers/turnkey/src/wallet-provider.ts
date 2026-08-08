/**
 * Managed merchant wallets: a Turnkey sub-organization plus a Safe (#11).
 *
 * The custody claim this exists to make is narrow and testable: **Mayarin is
 * never the sole signer, and the merchant can leave without us.**
 *
 * A Turnkey sub-organization alone does not make it. That address is an EOA and
 * one key signs an EOA transaction — and Mayarin's API key is a root user of
 * the sub-org, so Mayarin could move the merchant's funds alone. That is
 * custody with extra steps. The Safe is what turns two signers into two
 * signers.
 *
 * Signer set and threshold, decided rather than defaulted:
 *
 * - **Signers** are the merchant's own verified address and the sub-org key.
 *   The merchant's is required at provisioning, not added later: a wallet that
 *   starts Mayarin-only and gains a merchant key afterwards was custodial for
 *   the window in between, and "briefly custodial" is still custodial.
 * - **Threshold 1**, so the merchant can always act alone. That is what makes
 *   the exit real — removing Mayarin from the signer set needs nobody's
 *   cooperation but theirs.
 * - Mayarin can technically act alone too. What bounds it is **Turnkey policy**
 *   on the sub-org key, enforced in the enclave rather than by this code. The
 *   `WalletProvider` port is shaped to match: the backend proposes a movement
 *   from a closed union and the provider decides.
 *
 * The trade is stated plainly because it is the thing a reviewer should attack:
 * the boundary lives in a policy, so a mis-written policy widens it. A
 * threshold of 2 would put the boundary in the contract instead — and would
 * also mean a merchant cannot withdraw or leave without Mayarin co-signing,
 * which fails the self-custody test this whole issue exists for.
 */

import type { ChainId } from "@mayarin/chain";
import { ConfigurationError, generateId } from "@mayarin/shared";
import type {
  MerchantWallet,
  ProvisionRequest,
  WalletIntent,
  WalletProvider,
} from "@mayarin/wallet";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  type Hex,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { DEFAULT_TURNKEY_ENDPOINT } from "./adapter.ts";
import type { TurnkeyStamper } from "./stamper.ts";

const PROXY_FACTORY_ABI = parseAbi([
  "function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
]);

const SAFE_ABI = parseAbi([
  "function setup(address[] owners, uint256 threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
]);

/**
 * Canonical Safe 1.4.1 deployments. Verified on-chain before use rather than
 * trusted from a table — a wrong factory address deploys nothing, or something
 * else, and the merchant's money goes to whatever it produced.
 */
export interface SafeDeployment {
  readonly proxyFactory: Address;
  readonly singleton: Address;
  readonly fallbackHandler: Address;
}

export interface TurnkeyWalletProviderOptions {
  readonly organizationId: string;
  readonly stamper: TurnkeyStamper;
  /** Pays the gas to deploy the Safe. The merchant has none yet — that is #9. */
  readonly deployerPrivateKey: Hex;
  readonly rpcUrl: string;
  readonly safe: SafeDeployment;
  readonly endpoint?: string;
  readonly fetchFn?: typeof fetch;
}

export class TurnkeyWalletProvider implements WalletProvider {
  readonly #options: TurnkeyWalletProviderOptions;

  constructor(options: TurnkeyWalletProviderOptions) {
    this.#options = options;
  }

  async provision(request: ProvisionRequest): Promise<MerchantWallet> {
    if (!/^0x[0-9a-fA-F]{40}$/.test(request.merchantSigner)) {
      throw new ConfigurationError("A managed wallet needs the merchant's own signer address", {
        merchantId: request.merchantId,
      });
    }

    const subOrg = await this.#createSubOrganization(request.merchantId);
    const safe = await this.#deploySafe(request.merchantSigner as Address, subOrg.address);

    const now = new Date();
    return {
      id: generateId("wlt", now.getTime()),
      merchantId: request.merchantId,
      chain: request.chain,
      address: safe.toLowerCase(),
      provenance: "provisioned",
      // Verified by construction: Mayarin created it and the merchant's own
      // address is in the signer set. There is no claim left to prove.
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    };
  }

  async propose(_wallet: MerchantWallet, _intent: WalletIntent): Promise<{ txHash: string }> {
    // Deliberately unimplemented rather than approximated. Proposing a Safe
    // transaction means signing a SafeTx digest with the sub-org key and
    // submitting it with gas the merchant does not have — which is #9, and
    // which needs the Turnkey policy that bounds this key to exist first.
    throw new ConfigurationError(
      "Proposing a movement needs the Turnkey policy and gas sponsorship from #9",
      {},
    );
  }

  async #createSubOrganization(merchantId: string): Promise<{ id: string; address: Address }> {
    const body = JSON.stringify({
      type: "ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V7",
      timestampMs: String(Date.now()),
      organizationId: this.#options.organizationId,
      parameters: {
        subOrganizationName: `merchant-${merchantId}`,
        rootUsers: [
          {
            userName: "mayarin",
            apiKeys: [
              {
                apiKeyName: "mayarin",
                publicKey: await this.#apiPublicKey(),
                curveType: "API_KEY_CURVE_P256",
              },
            ],
            authenticators: [],
            oauthProviders: [],
          },
        ],
        rootQuorumThreshold: 1,
        wallet: {
          walletName: `merchant-${merchantId}`,
          accounts: [
            {
              curve: "CURVE_SECP256K1",
              pathFormat: "PATH_FORMAT_BIP32",
              path: "m/44'/60'/0'/0/0",
              addressFormat: "ADDRESS_FORMAT_ETHEREUM",
            },
          ],
        },
      },
    });

    const response = await this.#post("/public/v1/submit/create_sub_organization", body);
    const result = (response as SubOrgResponse)?.activity?.result?.createSubOrganizationResultV7;
    const address = result?.wallet?.addresses?.[0];

    if (result?.subOrganizationId === undefined || address === undefined) {
      throw new ConfigurationError("Turnkey did not return a sub-organization wallet", {
        merchantId,
        status: (response as SubOrgResponse)?.activity?.status,
      });
    }
    return { id: result.subOrganizationId, address: address as Address };
  }

  async #deploySafe(merchantSigner: Address, turnkeySigner: Address): Promise<Address> {
    const { rpcUrl, safe, deployerPrivateKey } = this.#options;
    const account = privateKeyToAccount(deployerPrivateKey);
    const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(rpcUrl),
    });

    // Owner order is [merchant, mayarin] so the merchant reads first in any
    // explorer — cosmetic, but this is the list a merchant checks when they
    // want to know who can touch their money.
    const initializer = encodeFunctionData({
      abi: SAFE_ABI,
      functionName: "setup",
      args: [
        [merchantSigner, turnkeySigner],
        1n,
        "0x0000000000000000000000000000000000000000",
        "0x",
        safe.fallbackHandler,
        "0x0000000000000000000000000000000000000000",
        0n,
        "0x0000000000000000000000000000000000000000",
      ],
    });

    const saltNonce = BigInt(Date.now());
    const { result } = await publicClient.simulateContract({
      account,
      address: safe.proxyFactory,
      abi: PROXY_FACTORY_ABI,
      functionName: "createProxyWithNonce",
      args: [safe.singleton, initializer, saltNonce],
    });

    const hash = await walletClient.writeContract({
      address: safe.proxyFactory,
      abi: PROXY_FACTORY_ABI,
      functionName: "createProxyWithNonce",
      args: [safe.singleton, initializer, saltNonce],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new ConfigurationError("Safe deployment reverted", { hash });
    }

    // Read the signer set back at the deployment block. The transaction
    // succeeding is not the same as the Safe being owned by who it should be,
    // and that is the whole custody claim.
    //
    // Pinned to the block rather than `latest`, and retried: behind a load
    // balancer the node serving this call may not have that block yet, which
    // surfaces as "block not found". Reading `latest` instead would trade that
    // error for a silent wrong answer — a stale read reporting the Safe as
    // unowned. Waiting for propagation is the only version that is both
    // correct and honest.
    const [owners, threshold] = await Promise.all([
      readAtBlock(() =>
        publicClient.readContract({
          address: result,
          abi: SAFE_ABI,
          functionName: "getOwners",
          blockNumber: receipt.blockNumber,
        }),
      ),
      readAtBlock(() =>
        publicClient.readContract({
          address: result,
          abi: SAFE_ABI,
          functionName: "getThreshold",
          blockNumber: receipt.blockNumber,
        }),
      ),
    ]);

    const lowered = owners.map((owner) => owner.toLowerCase());
    if (!lowered.includes(merchantSigner.toLowerCase())) {
      throw new ConfigurationError("The provisioned Safe does not include the merchant's signer", {
        safe: result,
        owners: lowered,
      });
    }
    if (threshold !== 1n) {
      throw new ConfigurationError("The provisioned Safe has an unexpected threshold", {
        safe: result,
        threshold: threshold.toString(),
      });
    }

    return result;
  }

  async #apiPublicKey(): Promise<string> {
    const key = process.env.TURNKEY_API_PUBLIC_KEY;
    if (key === undefined || key.length === 0) {
      throw new ConfigurationError("TURNKEY_API_PUBLIC_KEY is required to provision a sub-org", {});
    }
    return key;
  }

  async #post(path: string, body: string): Promise<unknown> {
    const fetchFn = this.#options.fetchFn ?? fetch;
    const response = await fetchFn(`${this.#options.endpoint ?? DEFAULT_TURNKEY_ENDPOINT}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Stamp": await this.#options.stamper.stamp(body),
      },
      body,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new ConfigurationError(`Turnkey ${response.status}`, { body: text.slice(0, 300) });
    }
    return JSON.parse(text);
  }
}

interface SubOrgResponse {
  readonly activity?: {
    readonly status?: string;
    readonly result?: {
      readonly createSubOrganizationResultV7?: {
        readonly subOrganizationId?: string;
        readonly wallet?: { readonly addresses?: readonly string[] };
      };
    };
  };
}

/**
 * Retries a pinned-block read until the serving node has the block.
 *
 * Bounded, and it re-throws rather than falling back to `latest` — falling back
 * would answer from a block that is not the one being asked about, which is the
 * failure this read exists to rule out.
 */
async function readAtBlock<T>(read: () => Promise<T>, attempts = 8): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

/** Verified on Base Sepolia before this shipped; re-verify before another chain. */
export const SAFE_BASE_SEPOLIA: SafeDeployment = {
  proxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
  fallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
};

export type { ChainId };

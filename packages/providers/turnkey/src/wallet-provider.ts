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
 *
 * ## What the policy binds, and what it does not
 *
 * **Turnkey policies do not apply to root users.** A sub-org needs a root user
 * to exist at all, and that root user is Mayarin's API key, so a policy written
 * against the root key would be decoration. The sub-org therefore holds two
 * Mayarin identities:
 *
 * - the **root** key, which creates the sub-org and nothing else afterwards. It
 *   is a break-glass credential and is not what the settlement path uses.
 * - a **non-root signer** user, which is default-denied by Turnkey and can act
 *   only through the policy created here: signing transactions addressed to
 *   *that merchant's Safe*, and nothing else.
 *
 * So the honest statement of the boundary is: the signer path is bounded in the
 * enclave, the root path is a credential Mayarin holds, and the reason neither
 * is custody of the merchant's money is the Safe — the merchant is an owner at
 * threshold 1 and can remove Mayarin whenever they like.
 *
 * ## Deterministic addressing
 *
 * `predictAddress` derives the Safe's address before it exists, from the signer
 * set and a salt derived from the merchant and chain. That is what makes
 * provisioning resumable: the orchestration writes its record first, and a
 * resumed attempt re-derives the same address and adopts whatever is at it
 * rather than deploying a second Safe.
 */

import type { ChainId } from "@mayarin/chain";
import {
  type AssetCode,
  ConfigurationError,
  ProviderError,
  ValidationError,
} from "@mayarin/shared";
import type {
  DeployResult,
  ManagedSigner,
  MerchantWallet,
  ProvisionRequest,
  WalletIntent,
  WalletProvider,
} from "@mayarin/wallet";
import {
  type Address,
  concatHex,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  type Hex,
  http,
  keccak256,
  type PublicClient,
  pad,
  parseAbi,
  serializeTransaction,
  type Transport,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { DEFAULT_TURNKEY_ENDPOINT } from "./adapter.ts";
import type { TurnkeyStamper } from "./stamper.ts";

const PROXY_FACTORY_ABI = parseAbi([
  "function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  "function proxyCreationCode() pure returns (bytes)",
]);

const SAFE_ABI = parseAbi([
  "function setup(address[] owners, uint256 threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)",
]);

const ERC20_ABI = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/** The non-root user the settlement path signs as. Bounded by policy. */
const SIGNER_USER_NAME = "mayarin-signer";

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
  /**
   * The chain this provider deploys on. One chain, deployed and proven, before
   * the address-derivation questions multiply (#11 non-goals).
   */
  readonly chain: ChainId;
  /** Pays the gas to deploy the Safe. The merchant has none yet — that is #9. */
  readonly deployerPrivateKey: Hex;
  readonly rpcUrl: string;
  readonly safe: SafeDeployment;
  /**
   * How the chain is reached. Defaults to `http(rpcUrl)`; a test supplies its
   * own so the address derivation can be exercised without a node, since that
   * derivation — not the transport — is what resumability depends on.
   */
  readonly transport?: Transport;
  /** Mayarin's root API key, which bootstraps a sub-org and is not policy-bound. */
  readonly rootApiPublicKey: string;
  /**
   * The public half of the key the settlement path signs with, installed as a
   * **non-root** user so the policy engine applies to it. Distinct from the
   * root key on purpose: same key, same user, no boundary.
   */
  readonly signerApiPublicKey: string;
  readonly endpoint?: string;
  readonly fetchFn?: typeof fetch;
  /**
   * ERC-20 addresses on this chain, by asset. A withdrawal in an asset that is
   * not here is refused rather than guessed at — the wrong token address moves
   * the wrong money.
   */
  readonly tokens?: Readonly<Partial<Record<AssetCode, string>>>;
  /** The chain's own currency, which is transferred by value rather than by a call. */
  readonly nativeAsset?: AssetCode;
  /**
   * The most gas Mayarin will fund a merchant's signer with for one withdrawal.
   *
   * A bound rather than a budget: the signer holds nothing, so every withdrawal
   * is funded, and an unbounded top-up would make a loop of failing withdrawals
   * a way to drain the deployer.
   */
  readonly maxGasTopUpWei?: bigint;
}

/** ~0.002 ETH: several times a Safe transfer on Base, nowhere near a drain. */
const DEFAULT_MAX_GAS_TOP_UP_WEI = 2_000_000_000_000_000n;

export class TurnkeyWalletProvider implements WalletProvider {
  readonly #options: TurnkeyWalletProviderOptions;

  constructor(options: TurnkeyWalletProviderOptions) {
    this.#options = options;
  }

  /**
   * Creates the merchant's sub-organization: a wallet key, a root user that
   * bootstraps it, and the non-root signer user the settlement path uses.
   *
   * No Safe yet, and no policy yet — the policy names the Safe's address, which
   * `predictAddress` derives from this signer.
   */
  async createManagedSigner(merchantId: string): Promise<ManagedSigner> {
    const body = JSON.stringify({
      type: "ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V7",
      timestampMs: String(Date.now()),
      organizationId: this.#options.organizationId,
      parameters: {
        subOrganizationName: `merchant-${merchantId}`,
        rootUsers: [
          {
            userName: "mayarin-root",
            apiKeys: [
              {
                apiKeyName: "mayarin-root",
                publicKey: this.#options.rootApiPublicKey,
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

    await this.#ensureSignerUser(result.subOrganizationId);
    return { ref: result.subOrganizationId, address: address.toLowerCase() };
  }

  /**
   * The Safe's address, derived rather than observed.
   *
   * Pure in its inputs — the signer set and a salt over merchant and chain — so
   * every attempt derives the same address and a resumed provision lands on the
   * Safe the previous attempt was making.
   */
  async predictAddress(request: ProvisionRequest): Promise<string> {
    this.#assertChain(request.chain);
    const client = this.#publicClient();
    const creationCode = await client.readContract({
      address: this.#options.safe.proxyFactory,
      abi: PROXY_FACTORY_ABI,
      functionName: "proxyCreationCode",
    });

    const initializer = this.#initializer(request);
    const salt = keccak256(
      concatHex([keccak256(initializer), pad(toHex(saltNonce(request)), { size: 32 })]),
    );
    const bytecode = concatHex([
      creationCode,
      encodeAbiParameters([{ type: "address" }], [this.#options.safe.singleton]),
    ]);

    return getContractAddress({
      opcode: "CREATE2",
      from: this.#options.safe.proxyFactory,
      salt,
      bytecodeHash: keccak256(bytecode),
    }).toLowerCase();
  }

  /**
   * Deploys the merchant's Safe, or checks the one already there.
   *
   * Idempotent because it reads the chain first: the address is deterministic,
   * so "already deployed" is a state this can recognise rather than a race it
   * has to lose.
   */
  async deploy(request: ProvisionRequest): Promise<DeployResult> {
    this.#assertChain(request.chain);
    if (!/^0x[0-9a-fA-F]{40}$/.test(request.merchantSigner)) {
      throw new ConfigurationError("A managed wallet needs the merchant's own signer address", {
        merchantId: request.merchantId,
      });
    }

    const address = (await this.predictAddress(request)) as Address;
    const client = this.#publicClient();

    // The policy is written before the Safe exists, and re-checked on every
    // attempt. A Safe whose signer key is not yet bounded is a window, however
    // short, in which the enclave would approve anything the key asked for.
    await this.#ensurePolicy(request.managedSigner.ref, address);

    const existing = await client.getCode({ address });
    if (existing !== undefined && existing !== "0x") {
      await this.#assertOwnership(client, address, request.merchantSigner as Address);
      return { address, deployed: false };
    }

    const account = privateKeyToAccount(this.#options.deployerPrivateKey);
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: this.#transport(),
    });

    const args = [
      this.#options.safe.singleton,
      this.#initializer(request),
      saltNonce(request),
    ] as const;
    await client.simulateContract({
      account,
      address: this.#options.safe.proxyFactory,
      abi: PROXY_FACTORY_ABI,
      functionName: "createProxyWithNonce",
      args,
    });
    const hash = await walletClient.writeContract({
      address: this.#options.safe.proxyFactory,
      abi: PROXY_FACTORY_ABI,
      functionName: "createProxyWithNonce",
      args,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new ConfigurationError("Safe deployment reverted", { hash });
    }

    // Read the signer set back at the deployment block. The transaction
    // succeeding is not the same as the Safe being owned by who it should be,
    // and that is the whole custody claim.
    await this.#assertOwnership(
      client,
      address,
      request.merchantSigner as Address,
      receipt.blockNumber,
    );
    return { address, deployed: true };
  }

  /**
   * Moves settlement out of the merchant's Safe.
   *
   * ## Why this is an owner-executed call and not a signed SafeTx digest
   *
   * The obvious implementation signs the SafeTx EIP-712 digest with the sub-org
   * key and lets anyone submit it. That would need `sign_raw_payload`, and the
   * policy this provider writes reads `eth.tx.to` — a condition a raw payload
   * has no value for, so the enclave would deny it. Widening the policy to
   * admit raw payloads would admit *any* digest, which is the entire boundary.
   *
   * So the sub-org key signs a real Ethereum transaction addressed to the Safe,
   * which is exactly what the policy already allows, and the Safe accepts it
   * with a pre-validated signature: for `v == 1` it takes `msg.sender` as the
   * approving owner without checking a signature at all. The key is an owner and
   * the threshold is 1, so one owner-sent call is a complete authorization.
   *
   * ## Gas
   *
   * The sub-org key is a fresh EOA and holds nothing, so the deployer tops it up
   * to the cost of this one submission. That is Mayarin paying the merchant's
   * gas — narrower than the general sponsorship in #9, and bounded twice: only
   * to this signer, and only up to `maxGasTopUpWei`.
   */
  async propose(wallet: MerchantWallet, intent: WalletIntent): Promise<{ txHash: string }> {
    this.#assertChain(wallet.chain);
    const managed = wallet.managed;
    if (managed === undefined) {
      throw new ConfigurationError("Only a managed wallet can be asked to move funds", {
        walletId: wallet.id,
      });
    }
    if (intent.amount.amount <= 0n) {
      throw new ValidationError("A withdrawal must be a positive amount", {
        amount: intent.amount.amount.toString(),
      });
    }

    const safe = getAddress(wallet.address);
    const signer = getAddress(managed.address);
    const inner = this.#innerCall(intent);
    const client = this.#publicClient();

    const data = encodeFunctionData({
      abi: SAFE_ABI,
      functionName: "execTransaction",
      args: [
        inner.to,
        inner.value,
        inner.data,
        0, // CALL, never DELEGATECALL: a delegate call rewrites the Safe itself.
        0n,
        0n,
        0n,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        prevalidatedSignature(signer),
      ],
    });

    const gas = await client.estimateGas({ account: signer, to: safe, data });
    // 20% over the estimate: the estimate is taken before the top-up lands, and
    // a submission that runs out of gas costs the fee and moves nothing.
    const gasLimit = (gas * 12n) / 10n;
    const fees = await client.estimateFeesPerGas();
    const maxFeePerGas = fees.maxFeePerGas;
    const maxPriorityFeePerGas = fees.maxPriorityFeePerGas;

    await this.#fundGas(client, signer, gasLimit * maxFeePerGas);

    const unsigned = serializeTransaction({
      type: "eip1559",
      chainId: baseSepolia.id,
      nonce: await client.getTransactionCount({ address: signer, blockTag: "pending" }),
      to: safe,
      value: 0n,
      data,
      gas: gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });

    const signed = await this.#signTransaction(managed.ref, signer, unsigned);
    const hash = await client.sendRawTransaction({ serializedTransaction: signed });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new ProviderError("The withdrawal transaction reverted", { hash, safe });
    }

    return { txHash: hash };
  }

  /** What the Safe is asked to do: a plain transfer, native or ERC-20. */
  #innerCall(intent: WalletIntent): { to: Address; value: bigint; data: Hex } {
    const to = getAddress(intent.to);
    if (intent.amount.asset === this.#options.nativeAsset) {
      return { to, value: intent.amount.amount, data: "0x" };
    }

    const token = this.#options.tokens?.[intent.amount.asset];
    if (token === undefined) {
      throw new ConfigurationError(
        `No token address configured for ${intent.amount.asset} on ${this.#options.chain}`,
        { asset: intent.amount.asset },
      );
    }

    return {
      to: getAddress(token),
      value: 0n,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [to, intent.amount.amount],
      }),
    };
  }

  /**
   * Tops the signer up to the cost of one submission, and no further.
   *
   * Refuses rather than sending a smaller amount when the cost exceeds the
   * bound: a partial top-up submits a transaction that runs out of gas, which
   * spends the fee and moves nothing.
   */
  async #fundGas(client: PublicClient, signer: Address, cost: bigint): Promise<void> {
    const balance = await client.getBalance({ address: signer });
    if (balance >= cost) return;

    const topUp = cost - balance;
    const bound = this.#options.maxGasTopUpWei ?? DEFAULT_MAX_GAS_TOP_UP_WEI;
    if (topUp > bound) {
      throw new ProviderError("The gas needed for this withdrawal exceeds the sponsorship bound", {
        needed: topUp.toString(),
        bound: bound.toString(),
      });
    }

    const account = privateKeyToAccount(this.#options.deployerPrivateKey);
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: this.#transport(),
    });
    const hash = await walletClient.sendTransaction({ to: signer, value: topUp });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new ProviderError("Funding the signer's gas reverted", { hash });
    }
  }

  /**
   * Signs a transaction with the merchant's sub-org key.
   *
   * `sign_transaction` rather than `sign_raw_payload` on purpose: the policy
   * bounds this key by the transaction's destination, and only a parsed
   * transaction has one.
   */
  async #signTransaction(subOrganizationId: string, signer: Address, unsigned: Hex): Promise<Hex> {
    const body = JSON.stringify({
      type: "ACTIVITY_TYPE_SIGN_TRANSACTION_V2",
      timestampMs: String(Date.now()),
      organizationId: subOrganizationId,
      parameters: {
        signWith: signer,
        unsignedTransaction: unsigned.slice(2),
        type: "TRANSACTION_TYPE_ETHEREUM",
      },
    });

    const response = (await this.#post(
      "/public/v1/submit/sign_transaction",
      body,
    )) as SignTransactionResponse;
    const signed = response?.activity?.result?.signTransactionResult?.signedTransaction;
    if (signed === undefined) {
      // A pending activity means the policy did not admit this transaction —
      // the destination is not the merchant's Safe, or the signer user is not
      // the one the policy names.
      throw new ProviderError("Turnkey did not return a signed transaction", {
        status: response?.activity?.status,
      });
    }

    return signed.startsWith("0x") ? (signed as Hex) : (`0x${signed}` as Hex);
  }

  /** The Safe `setup` call the proxy is initialised with. */
  #initializer(request: ProvisionRequest): Hex {
    // Owner order is [merchant, mayarin] so the merchant reads first in any
    // explorer — cosmetic, but this is the list a merchant checks when they
    // want to know who can touch their money.
    return encodeFunctionData({
      abi: SAFE_ABI,
      functionName: "setup",
      args: [
        [request.merchantSigner as Address, request.managedSigner.address as Address],
        1n,
        ZERO_ADDRESS,
        "0x",
        this.#options.safe.fallbackHandler,
        ZERO_ADDRESS,
        0n,
        ZERO_ADDRESS,
      ],
    });
  }

  /**
   * Fails unless the merchant owns the Safe at threshold 1.
   *
   * Pinned to a block when one is given, and retried: behind a load balancer
   * the node serving this call may not have that block yet, which surfaces as
   * "block not found". Reading `latest` instead would trade that error for a
   * silent wrong answer — a stale read reporting the Safe as unowned.
   */
  async #assertOwnership(
    client: PublicClient,
    safe: Address,
    merchantSigner: Address,
    blockNumber?: bigint,
  ): Promise<void> {
    const at = blockNumber === undefined ? {} : { blockNumber };
    const [owners, threshold] = await Promise.all([
      readAtBlock(() =>
        client.readContract({ address: safe, abi: SAFE_ABI, functionName: "getOwners", ...at }),
      ),
      readAtBlock(() =>
        client.readContract({ address: safe, abi: SAFE_ABI, functionName: "getThreshold", ...at }),
      ),
    ]);

    const lowered = owners.map((owner) => owner.toLowerCase());
    if (!lowered.includes(merchantSigner.toLowerCase())) {
      throw new ConfigurationError("The provisioned Safe does not include the merchant's signer", {
        safe,
        owners: lowered,
      });
    }
    if (threshold !== 1n) {
      throw new ConfigurationError("The provisioned Safe has an unexpected threshold", {
        safe,
        threshold: threshold.toString(),
      });
    }
  }

  /**
   * Installs the non-root signer user, once per sub-organization.
   *
   * Non-root is the load-bearing word: Turnkey's policy engine does not apply
   * to root users, so a signer that was root would be unbounded whatever policy
   * were written about it.
   */
  async #ensureSignerUser(subOrganizationId: string): Promise<string> {
    const existing = await this.#findSignerUser(subOrganizationId);
    if (existing !== undefined) return existing;

    const body = JSON.stringify({
      type: "ACTIVITY_TYPE_CREATE_USERS_V3",
      timestampMs: String(Date.now()),
      organizationId: subOrganizationId,
      parameters: {
        users: [
          {
            userName: SIGNER_USER_NAME,
            userTags: [],
            apiKeys: [
              {
                apiKeyName: SIGNER_USER_NAME,
                publicKey: this.#options.signerApiPublicKey,
                curveType: "API_KEY_CURVE_P256",
              },
            ],
            authenticators: [],
            oauthProviders: [],
          },
        ],
      },
    });

    await this.#post("/public/v1/submit/create_users", body);
    const created = await this.#findSignerUser(subOrganizationId);
    if (created === undefined) {
      throw new ConfigurationError("Turnkey did not create the policy-bound signer user", {
        subOrganizationId,
      });
    }
    return created;
  }

  async #findSignerUser(subOrganizationId: string): Promise<string | undefined> {
    const response = (await this.#post(
      "/public/v1/query/list_users",
      JSON.stringify({ organizationId: subOrganizationId }),
    )) as ListUsersResponse;
    return response?.users?.find((user) => user.userName === SIGNER_USER_NAME)?.userId;
  }

  /**
   * Bounds the signer user to this merchant's Safe, once per sub-organization.
   *
   * Turnkey denies a non-root user by default, so this policy is the *only*
   * thing that key can do: sign transactions addressed to that Safe. It cannot
   * pay another address, and it cannot sign for another merchant, because a
   * sub-organization holds exactly one merchant's key.
   *
   * Keyed by name and re-checked rather than blindly created: provisioning
   * retries, and a second identical policy would be noise in the surface a
   * reviewer has to read to know what the key may do.
   */
  async #ensurePolicy(subOrganizationId: string, safe: Address): Promise<void> {
    const policyName = `mayarin-signer-to-${safe.toLowerCase()}`;
    const listed = (await this.#post(
      "/public/v1/query/list_policies",
      JSON.stringify({ organizationId: subOrganizationId }),
    )) as ListPoliciesResponse;
    if (listed?.policies?.some((policy) => policy.policyName === policyName)) return;

    const signerUserId = await this.#ensureSignerUser(subOrganizationId);
    const body = JSON.stringify({
      type: "ACTIVITY_TYPE_CREATE_POLICY_V3",
      timestampMs: String(Date.now()),
      organizationId: subOrganizationId,
      parameters: {
        policyName,
        effect: "EFFECT_ALLOW",
        consensus: `approvers.any(user, user.id == '${signerUserId}')`,
        condition: `eth.tx.to == '${safe.toLowerCase()}'`,
        notes: "Mayarin's settlement key may only sign transactions to this merchant's Safe (#11)",
      },
    });
    await this.#post("/public/v1/submit/create_policy", body);
  }

  #publicClient(): PublicClient {
    return createPublicClient({
      chain: baseSepolia,
      transport: this.#transport(),
    }) as PublicClient;
  }

  #transport(): Transport {
    return this.#options.transport ?? http(this.#options.rpcUrl);
  }

  #assertChain(chain: ChainId): void {
    if (chain === this.#options.chain) return;
    throw new ConfigurationError(
      `This wallet provider deploys on ${this.#options.chain}, not ${chain}`,
      { chain },
    );
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

/**
 * The salt a merchant's Safe is deployed at.
 *
 * Derived from the merchant and the chain rather than from a clock, which is
 * what makes the address the same on every attempt — the property the whole
 * resumable provisioning path rests on.
 */
function saltNonce(request: ProvisionRequest): bigint {
  return BigInt(keccak256(toHex(`mayarin:wallet:${request.merchantId}:${request.chain}`)));
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
 * The Safe's "the caller is an owner" signature.
 *
 * `r` carries the owner's address, `s` is unused, and `v == 1` tells
 * `checkNSignatures` to accept it when `msg.sender` is that owner — so no
 * digest is signed at all. Valid only because the sub-org key sends the
 * transaction itself; handed to anyone else it authorizes nothing.
 */
export function prevalidatedSignature(owner: Address): Hex {
  return concatHex([pad(owner, { size: 32 }), pad("0x", { size: 32 }), "0x01"]);
}

interface SignTransactionResponse {
  readonly activity?: {
    readonly status?: string;
    readonly result?: {
      readonly signTransactionResult?: { readonly signedTransaction?: string };
    };
  };
}

interface ListUsersResponse {
  readonly users?: readonly { readonly userId?: string; readonly userName?: string }[];
}

interface ListPoliciesResponse {
  readonly policies?: readonly { readonly policyName?: string }[];
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

/**
 * The same canonical 1.4.1 addresses, read off Arc testnet on 4 September 2026
 * rather than assumed from Base: proxy factory 3055 bytes, `SafeL2` singleton
 * 24422, fallback handler 5638 — byte-for-byte the sizes Base reports.
 *
 * Checking was the point. Safe publishes these as canonical, but a chain that
 * had not been through the deterministic-deployment ceremony would leave one of
 * them empty, and deploying against an empty factory produces no wallet while
 * looking exactly like a wallet that failed to index.
 */
export const SAFE_ARC_TESTNET: SafeDeployment = {
  proxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
  fallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
};

/**
 * Where a Safe can be deployed, by chain.
 *
 * A chain absent here cannot provision, and that is the honest answer rather
 * than falling back to another chain's addresses — which, since the salt already
 * carries the chain, would deploy a wallet nobody predicted at an address nobody
 * recorded.
 */
export const SAFE_DEPLOYMENTS: Readonly<Partial<Record<ChainId, SafeDeployment>>> = {
  "base-sepolia": SAFE_BASE_SEPOLIA,
  "arc-testnet": SAFE_ARC_TESTNET,
};

export function safeDeploymentFor(chain: ChainId): SafeDeployment {
  const deployment = SAFE_DEPLOYMENTS[chain];
  if (deployment === undefined) {
    throw new ConfigurationError(
      `No verified Safe deployment for ${chain}. Read the factory, singleton and fallback handler off that chain before adding one.`,
      { chain },
    );
  }
  return deployment;
}

export type { ChainId };

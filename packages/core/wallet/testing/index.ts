/**
 * Reference in-memory fake for the wallet port, in a segregated `/testing`
 * subpath so domain `src/` stays pure.
 *
 * Mirrors the Postgres invariant the guard depends on: one wallet per address
 * per chain. A fake that let two merchants claim one address would let a test
 * pass that the real adapter cannot.
 */

import type { ChainId } from "@mayarin/chain";
import { type AssetCode, ConfigurationError, ConflictError, type Money } from "@mayarin/shared";
import type {
  CreateMerchantKeyRequest,
  DeployResult,
  ManagedSigner,
  MerchantKey,
  MerchantKeyProvider,
  MerchantWallet,
  MerchantWalletRepository,
  ProvisionRequest,
  WalletBalanceQuery,
  WalletBalanceReader,
  WalletChallenge,
  WalletChallengeRepository,
  WalletIntent,
  WalletProvider,
  WalletWithdrawal,
  WalletWithdrawalCursor,
  WalletWithdrawalRepository,
} from "../src/index.ts";

export class InMemoryWalletWithdrawalRepository implements WalletWithdrawalRepository {
  readonly #withdrawals: WalletWithdrawal[] = [];

  async insert(withdrawal: WalletWithdrawal): Promise<void> {
    this.#withdrawals.push(withdrawal);
  }

  async listRecent(
    merchantId: string,
    limit: number,
    cursor?: WalletWithdrawalCursor,
  ): Promise<readonly WalletWithdrawal[]> {
    const ordered = this.#withdrawals
      .filter((withdrawal) => withdrawal.merchantId === merchantId)
      .sort(
        (left, right) =>
          right.completedAt.getTime() - left.completedAt.getTime() ||
          right.id.localeCompare(left.id),
      );
    // Same keyset the Postgres adapter applies, so a test that pages sees the
    // boundary the real one would.
    const after =
      cursor === undefined
        ? ordered
        : ordered.filter(
            (withdrawal) =>
              withdrawal.completedAt.getTime() < cursor.completedAt.getTime() ||
              (withdrawal.completedAt.getTime() === cursor.completedAt.getTime() &&
                withdrawal.id < cursor.id),
          );
    return after.slice(0, limit);
  }
}

/**
 * Balances a test sets rather than a chain reports.
 *
 * Keyed by address and asset, and an asset with nothing set is *omitted* rather
 * than zero — the same distinction the real reader makes between "this
 * deployment has no address for that token" and "the wallet is empty".
 */
export class InMemoryWalletBalanceReader implements WalletBalanceReader {
  readonly #balances = new Map<string, bigint>();

  set(address: string, asset: AssetCode, amount: bigint): void {
    this.#balances.set(`${address.toLowerCase()}:${asset}`, amount);
  }

  async balances(query: WalletBalanceQuery): Promise<readonly Money[]> {
    const found: Money[] = [];
    for (const asset of query.assets) {
      const amount = this.#balances.get(`${query.address.toLowerCase()}:${asset}`);
      if (amount === undefined) continue;
      found.push({ amount, asset });
    }
    return found;
  }
}

export class InMemoryMerchantWalletRepository implements MerchantWalletRepository {
  readonly #byId = new Map<string, MerchantWallet>();

  async insert(wallet: MerchantWallet): Promise<void> {
    const existing = await this.findByAddress(wallet.chain, wallet.address);
    if (existing !== null) {
      throw new ConflictError(`${wallet.address} on ${wallet.chain} is already claimed`, {
        chain: wallet.chain,
        address: wallet.address,
      });
    }
    this.#byId.set(wallet.id, wallet);
  }

  async update(wallet: MerchantWallet): Promise<void> {
    this.#byId.set(wallet.id, wallet);
  }

  async findById(id: string): Promise<MerchantWallet | null> {
    return this.#byId.get(id) ?? null;
  }

  async findManaged(merchantId: string, chain: ChainId): Promise<MerchantWallet | null> {
    for (const wallet of this.#byId.values()) {
      if (
        wallet.merchantId === merchantId &&
        wallet.chain === chain &&
        wallet.provenance === "provisioned"
      ) {
        return wallet;
      }
    }
    return null;
  }

  async findByAddress(chain: ChainId, address: string): Promise<MerchantWallet | null> {
    const normalised = address.toLowerCase();
    for (const wallet of this.#byId.values()) {
      if (wallet.chain === chain && wallet.address === normalised) return wallet;
    }
    return null;
  }

  async listByMerchant(merchantId: string): Promise<readonly MerchantWallet[]> {
    return [...this.#byId.values()].filter((wallet) => wallet.merchantId === merchantId);
  }
}

/**
 * In-memory challenges.
 *
 * `consume` reports whether *this* call was the one that used it, mirroring the
 * conditional update the Postgres adapter relies on — a fake that let two calls
 * both succeed would hide the race the real one prevents.
 */
export class InMemoryWalletChallengeRepository implements WalletChallengeRepository {
  readonly #byId = new Map<string, WalletChallenge>();
  readonly #consumed = new Set<string>();

  async insert(challenge: WalletChallenge): Promise<void> {
    this.#byId.set(challenge.id, challenge);
  }

  async findById(id: string): Promise<WalletChallenge | null> {
    return this.#byId.get(id) ?? null;
  }

  async consume(id: string): Promise<boolean> {
    if (this.#consumed.has(id)) return false;
    this.#consumed.add(id);
    return true;
  }
}

/**
 * Reference fake for the wallet provider.
 *
 * It keeps the two properties the real provider is built around, because they
 * are the ones the provisioner's resumability rests on:
 *
 * - `predictAddress` is a pure function of the signer set, so every attempt
 *   derives the same address.
 * - `deploy` adopts an address that already has a wallet at it rather than
 *   making a second one.
 *
 * `signers` and `deploys` count the calls, so a test can assert that a resumed
 * provision created no second signer — an assertion on the return value alone
 * would pass while a duplicate sub-organization existed.
 */
export class FakeWalletProvider implements WalletProvider {
  readonly signers: string[] = [];
  readonly deploys: string[] = [];
  readonly proposals: { wallet: MerchantWallet; intent: WalletIntent }[] = [];
  readonly #deployed = new Set<string>();
  #next = 0;
  /** Set to make the next call of that step throw, standing in for a crash. */
  failOn: "createManagedSigner" | "predictAddress" | "deploy" | "propose" | undefined;

  async createManagedSigner(merchantId: string): Promise<ManagedSigner> {
    this.#crashIf("createManagedSigner");
    this.#next += 1;
    const signer = {
      ref: `sub-${merchantId}-${this.#next}`,
      address: `0x${this.#next.toString(16).padStart(40, "a")}`,
    };
    this.signers.push(signer.ref);
    return signer;
  }

  async predictAddress(request: ProvisionRequest): Promise<string> {
    this.#crashIf("predictAddress");
    // Deterministic in exactly what the real derivation depends on: the salt
    // chain and both signers — not the chain deployed on, which is what lets one
    // merchant hold the same address everywhere. A fake that keyed on the
    // merchant id alone would let a resume-with-a-different-signer bug pass.
    const seed = `${request.merchantId}:${request.saltChain}:${request.merchantSigner}:${request.managedSigner.address}`;
    let hash = 0n;
    for (const character of seed) {
      hash = (hash * 31n + BigInt(character.codePointAt(0) ?? 0)) % 2n ** 160n;
    }
    return `0x${hash.toString(16).padStart(40, "0").slice(-40)}`;
  }

  async deploy(request: ProvisionRequest): Promise<DeployResult> {
    this.#crashIf("deploy");
    const address = await this.predictAddress(request);
    this.deploys.push(address);
    if (this.#deployed.has(address)) return { address, deployed: false };
    this.#deployed.add(address);
    return { address, deployed: true };
  }

  /**
   * Records the movement and reports a hash.
   *
   * `proposals` is what a test asserts on: that the amount and destination that
   * reached the provider are the ones the merchant asked for, which a return
   * value alone cannot show.
   */
  async propose(wallet: MerchantWallet, intent: WalletIntent): Promise<{ txHash: string }> {
    if (this.failOn === "propose") {
      this.failOn = undefined;
      throw new ConfigurationError("fake provider refused the movement", {});
    }
    this.proposals.push({ wallet, intent });
    return { txHash: `0x${(this.proposals.length + 0xf000).toString(16).padStart(64, "b")}` };
  }

  #crashIf(step: NonNullable<FakeWalletProvider["failOn"]>): void {
    if (this.failOn !== step) return;
    this.failOn = undefined;
    throw new Error(`fake provider crashed during ${step}`);
  }
}

/**
 * Reference fake for the merchant-key port.
 *
 * A fresh address every call, because that is what the real provider does: each
 * passkey gets its own organization and its own key, so a test asserting that
 * asking twice yields one wallet would pass against a fake that reused one
 * address and fail against Turnkey.
 *
 * `attestations` records what was passed, which is how a test checks that the
 * passkey reached the provider rather than being dropped on the way.
 */
export class FakeMerchantKeyProvider implements MerchantKeyProvider {
  readonly attestations: CreateMerchantKeyRequest[] = [];
  /**
   * Addresses to hand out, oldest first, before falling back to generated ones.
   *
   * A test that wants to *sign* with the created key pushes the address of a key
   * it holds. That is the only way to exercise verification honestly: the point
   * of the passkey path is that the key really signs, and an address nobody has
   * the key for can only ever demonstrate the refusal.
   */
  readonly addresses: string[] = [];
  #next = 0;
  /** Set to make the next call throw, standing in for a provider outage. */
  fail = false;

  async createMerchantKey(request: CreateMerchantKeyRequest): Promise<MerchantKey> {
    if (this.fail) {
      this.fail = false;
      throw new Error("fake key provider is down");
    }
    this.attestations.push(request);
    this.#next += 1;
    const queued = this.addresses.shift();
    return {
      ref: `merchant-key-sub-${request.merchantId}-${this.#next}`,
      address: queued ?? `0x${this.#next.toString(16).padStart(40, "c")}`,
    };
  }
}

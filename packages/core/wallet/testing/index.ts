/**
 * Reference in-memory fake for the wallet port, in a segregated `/testing`
 * subpath so domain `src/` stays pure.
 *
 * Mirrors the Postgres invariant the guard depends on: one wallet per address
 * per chain. A fake that let two merchants claim one address would let a test
 * pass that the real adapter cannot.
 */

import type { ChainId } from "@mayarin/chain";
import { ConfigurationError, ConflictError } from "@mayarin/shared";
import type {
  DeployResult,
  ManagedSigner,
  MerchantWallet,
  MerchantWalletRepository,
  ProvisionRequest,
  WalletChallenge,
  WalletChallengeRepository,
  WalletIntent,
  WalletProvider,
} from "../src/index.ts";

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
  readonly #deployed = new Set<string>();
  #next = 0;
  /** Set to make the next call of that step throw, standing in for a crash. */
  failOn: "createManagedSigner" | "predictAddress" | "deploy" | undefined;

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
    // Deterministic in exactly what the real derivation depends on: the chain
    // and both signers. A fake that keyed on the merchant id alone would let a
    // resume-with-a-different-signer bug pass.
    const seed = `${request.chain}:${request.merchantSigner}:${request.managedSigner.address}`;
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

  async propose(_wallet: MerchantWallet, _intent: WalletIntent): Promise<{ txHash: string }> {
    throw new ConfigurationError("The fake provider proposes nothing", {});
  }

  #crashIf(step: NonNullable<FakeWalletProvider["failOn"]>): void {
    if (this.failOn !== step) return;
    this.failOn = undefined;
    throw new Error(`fake provider crashed during ${step}`);
  }
}

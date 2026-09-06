/**
 * x402 resources, as a merchant manages their own (#208).
 *
 * Registration used to be an operator act behind `ADMIN_TOKEN`, because a
 * resource names the address a payer is told to pay and a typo there sends
 * every payment on that rail somewhere nobody controls. That reasoning argues
 * for guarding the *address*, not for keeping merchants out of their own
 * catalogue — so this service never lets one be typed. A rail is offered only
 * where the merchant already has a verified wallet, and `payTo` is filled from
 * it.
 *
 * **Same-asset only.** A cross-asset rail pays the operator, not the merchant,
 * and is only payable where this deployment also has a quote engine and a
 * settler. Those live in the payment API; offering the choice here would mean
 * either duplicating that judgement or letting a merchant register a rail no
 * payer could pay. Cross-asset registration stays on the payment API's own
 * merchant route, which owns both.
 */

import type { MerchantRepository } from "@mayarin/auth";
import type { ChainId } from "@mayarin/chain";
import { type AssetCode, type Money, NotFoundError, ValidationError } from "@mayarin/shared";
import type { MerchantWalletRepository } from "@mayarin/wallet";
import type { AssetCapabilities, X402Resource, X402ResourceRepository } from "@mayarin/x402";
import type { Scope } from "../dto/auth.ts";

/** One rail a merchant could offer, with nothing left for them to type. */
export interface RailOption {
  readonly chain: ChainId;
  readonly asset: AssetCode;
  readonly contract: string;
  /** Where this rail would pay: the merchant's own verified address. */
  readonly payTo: string;
}

export interface CreateResourceInput {
  readonly id: string;
  readonly url: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly price: Money;
  readonly maxTimeoutSeconds: number;
  /** Which of the offered rails to register. Anything else is refused. */
  readonly chains: readonly ChainId[];
}

export interface X402ResourceServiceOptions {
  readonly resources: X402ResourceRepository;
  readonly merchants: MerchantRepository;
  readonly wallets: MerchantWalletRepository;
  readonly capabilities: AssetCapabilities;
  /** The ERC-20 address per chain and asset, as this deployment is configured. */
  readonly tokens: Partial<Record<ChainId, Partial<Record<AssetCode, string>>>>;
}

export class X402ResourceService {
  readonly #options: X402ResourceServiceOptions;

  constructor(options: X402ResourceServiceOptions) {
    this.#options = options;
  }

  list(scope: Scope): Promise<readonly X402Resource[]> {
    return this.#options.resources.listByMerchant(scope.merchantId);
  }

  /**
   * The rails this merchant could offer today.
   *
   * Empty is a real answer and the form says so: a merchant with no verified
   * wallet on any configured chain has nowhere to be paid, and the fix is to
   * link a wallet rather than to type an address here.
   */
  async rails(scope: Scope): Promise<readonly RailOption[]> {
    const merchant = await this.#merchant(scope);
    const settlementAsset = merchant.settlementAsset;
    const wallets = await this.#options.wallets.listByMerchant(scope.merchantId);
    const options: RailOption[] = [];

    for (const [chain, assets] of Object.entries(this.#options.tokens) as [
      ChainId,
      Partial<Record<AssetCode, string>>,
    ][]) {
      const contract = assets[settlementAsset];
      if (contract === undefined) continue;
      // The merchant's configured address wins, the way the signer reads it;
      // otherwise their verified wallet on this chain. An unverified wallet is
      // a claim, and a claim is not somewhere to send money.
      const verified = wallets.find(
        (wallet) => wallet.chain === chain && wallet.verifiedAt !== undefined,
      );
      const payTo = merchant.settlementAddress ?? verified?.address;
      if (payTo === undefined) continue;
      options.push({ chain, asset: settlementAsset, contract, payTo });
    }

    return options;
  }

  async create(scope: Scope, input: CreateResourceInput): Promise<X402Resource> {
    if (input.chains.length === 0) {
      throw new ValidationError("Choose at least one chain to be paid on", {});
    }
    const offered = await this.rails(scope);
    const chosen = input.chains.map((chain) => {
      const rail = offered.find((option) => option.chain === chain);
      if (rail === undefined) {
        throw new ValidationError(
          `This merchant cannot be paid on ${chain}: link and verify a wallet there first`,
          { chain },
        );
      }
      return rail;
    });

    const accepts = [];
    for (const rail of chosen) {
      // The chain's answer, not the form's. A row can claim a transfer method
      // the token does not implement, and the payer finds out by signing
      // something that will never be accepted.
      const capability = await this.#options.capabilities.of(rail.chain, rail.contract);
      accepts.push({
        chain: rail.chain,
        asset: rail.asset,
        contract: rail.contract,
        payTo: rail.payTo,
        domain: capability.domain,
        transferMethod: capability.transferMethod,
      });
    }

    const resource: X402Resource = {
      id: input.id,
      merchantId: scope.merchantId,
      url: input.url,
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.mimeType === undefined ? {} : { mimeType: input.mimeType }),
      price: input.price,
      accepts,
      maxTimeoutSeconds: input.maxTimeoutSeconds,
    };

    // A resource id is the payer's handle on a price, so taking one that
    // already belongs to another merchant would repoint their endpoint.
    const existing = await this.#options.resources.findById(input.id);
    if (existing !== undefined && existing.merchantId !== scope.merchantId) {
      throw new ValidationError(`The resource id "${input.id}" is taken`, { id: input.id });
    }

    await this.#options.resources.save(resource);
    return resource;
  }

  async #merchant(scope: Scope) {
    const merchant = await this.#options.merchants.findById(scope.merchantId);
    if (merchant === null) {
      throw new NotFoundError(`Merchant ${scope.merchantId} not found`, { id: scope.merchantId });
    }
    return merchant;
  }
}

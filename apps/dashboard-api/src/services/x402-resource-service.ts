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
 * A cross-asset rail — the agent holds EURC, the merchant settles in USDC — is
 * offered too, and it pays the **operator** rather than the merchant. That is
 * forced, not chosen: `transferWithAuthorization` names one recipient before
 * the payer signs, and the payer's asset has to land somewhere Mayarin can swap
 * it from. Whether this deployment can serve one at all, and at which address,
 * is the payment API's answer rather than a guess made here — a rail pointed at
 * the wrong operator is refused at registration, which is the good failure, but
 * only because someone asked.
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
  /** Where this rail pays: the merchant for same-asset, the operator otherwise. */
  readonly payTo: string;
  /**
   * `cross-asset` means the agent pays this asset and the merchant is still
   * paid their own — worth saying in the form, because the address shown is
   * deliberately not the merchant's.
   */
  readonly kind: "same-asset" | "cross-asset";
}

/** One offered rail, named the way a caller picks it: chain plus asset. */
export interface RailChoice {
  readonly chain: ChainId;
  readonly asset: AssetCode;
}

/** An edit changes everything a resource has except the id it is known by. */
export type UpdateResourceInput = Omit<CreateResourceInput, "id">;

export interface CreateResourceInput {
  readonly id: string;
  readonly url: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly price: Money;
  readonly maxTimeoutSeconds: number;
  /** Which of the offered rails to register. Anything else is refused. */
  readonly rails: readonly RailChoice[];
}

export interface X402ResourceServiceOptions {
  readonly resources: X402ResourceRepository;
  readonly merchants: MerchantRepository;
  readonly wallets: MerchantWalletRepository;
  readonly capabilities: AssetCapabilities;
  /**
   * Where a cross-asset rail pays, or `undefined` when this deployment cannot
   * serve one. Asked of the payment API, which owns the quote engine and the
   * settler that decide it.
   */
  readonly crossAssetOperator: () => Promise<string | undefined>;
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
    const operator = await this.#options.crossAssetOperator();
    const options: RailOption[] = [];

    for (const [chain, assets] of Object.entries(this.#options.tokens) as [
      ChainId,
      Partial<Record<AssetCode, string>>,
    ][]) {
      // The merchant's configured address wins, the way the signer reads it;
      // otherwise their verified wallet on this chain. An unverified wallet is
      // a claim, and a claim is not somewhere to send money.
      const verified = wallets.find(
        (wallet) => wallet.chain === chain && wallet.verifiedAt !== undefined,
      );
      const settleTo = merchant.settlementAddress ?? verified?.address;
      // Nowhere to be paid on this chain: neither rail can be offered, because
      // a cross-asset one still ends with the merchant paid here.
      if (settleTo === undefined) continue;

      for (const [asset, contract] of Object.entries(assets) as [AssetCode, string][]) {
        if (asset === settlementAsset) {
          options.push({ chain, asset, contract, payTo: settleTo, kind: "same-asset" });
        } else if (operator !== undefined) {
          options.push({ chain, asset, contract, payTo: operator, kind: "cross-asset" });
        }
      }
    }

    return options;
  }

  async create(scope: Scope, input: CreateResourceInput): Promise<X402Resource> {
    if (input.rails.length === 0) {
      throw new ValidationError("Choose at least one rail to be paid over", {});
    }
    const accepts = await this.#accepts(scope, input.rails);

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
    // already belongs to another merchant would repoint their endpoint. Taking
    // one of the merchant's own is refused too, now that editing exists:
    // creation that silently overwrote an endpoint would lose its rails to a
    // form the merchant thought was blank.
    const existing = await this.#options.resources.findById(input.id);
    if (existing !== undefined) {
      throw new ValidationError(`The resource id "${input.id}" is taken`, { id: input.id });
    }

    await this.#options.resources.save(resource);
    return resource;
  }

  /**
   * Changes one of this merchant's own endpoints.
   *
   * **The id never moves.** It is the payer's handle on a price — it is what
   * `requirePayment` gates on and what a `402` already handed out — so renaming
   * one would silently unregister the endpoint an agent is holding a quote for.
   * Everything else is editable, rails included.
   *
   * The rails are rebuilt from the merchant's current options rather than
   * patched, for the same reason creation builds them: a rail's `payTo` and
   * transfer method come from the wallet and the token, and carrying the old
   * ones forward would keep paying an address the merchant may since have
   * replaced.
   */
  async update(scope: Scope, id: string, input: UpdateResourceInput): Promise<X402Resource> {
    if (input.rails.length === 0) {
      throw new ValidationError("Choose at least one rail to be paid over", {});
    }
    const existing = await this.#options.resources.findById(id);
    if (existing === undefined || existing.merchantId !== scope.merchantId) {
      throw new NotFoundError(`Endpoint ${id} not found`, { id });
    }

    const resource: X402Resource = {
      id: existing.id,
      merchantId: existing.merchantId,
      url: input.url,
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.mimeType === undefined ? {} : { mimeType: input.mimeType }),
      price: input.price,
      accepts: await this.#accepts(scope, input.rails),
      maxTimeoutSeconds: input.maxTimeoutSeconds,
    };

    await this.#options.resources.save(resource);
    return resource;
  }

  /**
   * The rails a merchant chose, resolved against the ones they may actually
   * offer and confirmed against the token.
   *
   * Two refusals live here. A rail this merchant cannot be paid on is named
   * rather than dropped, because a silently missing rail is a resource that
   * quietly stops accepting an asset. And the transfer method comes from the
   * chain rather than the form: a row can claim a method the token does not
   * implement, and a payer discovers that by signing something no contract will
   * ever accept.
   */
  async #accepts(scope: Scope, rails: readonly RailChoice[]) {
    const offered = await this.rails(scope);
    const chosen = rails.map((choice) => {
      const rail = offered.find(
        (option) => option.chain === choice.chain && option.asset === choice.asset,
      );
      if (rail === undefined) {
        throw new ValidationError(
          `This merchant cannot take ${choice.asset} on ${choice.chain}: verify a wallet there, and check the asset is configured`,
          { chain: choice.chain, asset: choice.asset },
        );
      }
      return rail;
    });

    const accepts = [];
    for (const rail of chosen) {
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
    return accepts;
  }

  /**
   * Withdraws one of this merchant's own endpoints.
   *
   * Another merchant's id is a `NotFoundError` rather than a refusal: the
   * caller learns nothing about what exists outside their own account, which is
   * the same posture every other listing here takes.
   */
  async remove(scope: Scope, id: string): Promise<void> {
    const existing = await this.#options.resources.findById(id);
    if (existing === undefined || existing.merchantId !== scope.merchantId) {
      throw new NotFoundError(`Endpoint ${id} not found`, { id });
    }
    await this.#options.resources.remove(id);
  }

  async #merchant(scope: Scope) {
    const merchant = await this.#options.merchants.findById(scope.merchantId);
    if (merchant === null) {
      throw new NotFoundError(`Merchant ${scope.merchantId} not found`, { id: scope.merchantId });
    }
    return merchant;
  }
}

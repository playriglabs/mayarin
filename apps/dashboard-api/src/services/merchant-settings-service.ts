/**
 * Merchant settings application service (#95).
 *
 * The merchant record has carried `settlementAsset`, `acceptedAssets` and
 * `settlementAddress` since auth shipped, and until now the only way to write
 * them was an `UPDATE` in a psql session. That is not something an SDK consumer
 * or a dashboard can do, and `PRICE_LOCKED` refuses to sign without a
 * settlement address — so a merchant with no way to set one cannot take a
 * contract-path payment at all.
 *
 * Every method takes the caller's `Scope` and reads `scope.merchantId` from it.
 * No method accepts a merchant id as an argument: a merchant id that arrives
 * from a request body and is used unchecked is how one merchant redirects
 * another's payouts, and the safest way to not do that is to make it
 * unexpressible.
 */

import type {
  Merchant,
  MerchantRepository,
  MerchantSettingChange,
  MerchantSettingChangeRepository,
  MerchantSettingsPatch,
} from "@mayarin/auth";
import { diffMerchantSettings, updateMerchantSettings } from "@mayarin/auth";
import { type Clock, generateId, NotFoundError } from "@mayarin/shared";
import type { Scope } from "../dto/auth.ts";

export interface MerchantSettingsServiceOptions {
  readonly merchants: MerchantRepository;
  readonly changes: MerchantSettingChangeRepository;
  readonly clock: Clock;
}

export class MerchantSettingsService {
  readonly #merchants: MerchantRepository;
  readonly #changes: MerchantSettingChangeRepository;
  readonly #clock: Clock;

  constructor(options: MerchantSettingsServiceOptions) {
    this.#merchants = options.merchants;
    this.#changes = options.changes;
    this.#clock = options.clock;
  }

  async get(scope: Scope): Promise<Merchant> {
    const merchant = await this.#merchants.findById(scope.merchantId);
    if (merchant === null) {
      throw new NotFoundError(`Merchant ${scope.merchantId} not found`, { id: scope.merchantId });
    }
    return merchant;
  }

  /**
   * Applies a patch to the caller's own merchant.
   *
   * Validation runs before anything is written — a malformed payout address is
   * refused here, not discovered at `PRICE_LOCKED` months later with nobody
   * left to ask about it.
   *
   * The audit row is written after the merchant row rather than in the same
   * transaction. A missing audit entry for a change that happened is the
   * failure mode; the reverse — an audit entry for a change that did not — is
   * the one that would make the trail lie, and this ordering cannot produce it.
   */
  async update(
    scope: Scope,
    actorUserId: string,
    patch: MerchantSettingsPatch,
  ): Promise<{ merchant: Merchant; changes: readonly MerchantSettingChange[] }> {
    const current = await this.get(scope);
    const now = this.#clock.now();
    const next = updateMerchantSettings(current, patch, now);

    const diff = diffMerchantSettings(current, next);
    if (diff.length === 0) return { merchant: current, changes: [] };

    await this.#merchants.update(next);

    const changes: MerchantSettingChange[] = diff.map((entry) => ({
      id: generateId("msc", now.getTime()),
      merchantId: current.id,
      userId: actorUserId,
      field: entry.field,
      ...(entry.previous === undefined ? {} : { previousValue: entry.previous }),
      ...(entry.next === undefined ? {} : { nextValue: entry.next }),
      changedAt: now,
    }));
    await this.#changes.append(changes);

    return { merchant: next, changes };
  }

  /** The caller's own change history. Scoped, like everything else here. */
  async history(scope: Scope, limit?: number): Promise<readonly MerchantSettingChange[]> {
    return this.#changes.list(scope.merchantId, limit);
  }
}

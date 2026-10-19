import type { AssetCode } from "@mayarin/shared";
import type { Denylist, RiskHistory } from "../src/types.ts";

/** Reference fakes: counts you set directly, a denylist you fill. */
export class InMemoryRiskHistory implements RiskHistory {
  payer = new Map<string, number>();
  merchant = new Map<string, number>();
  paid = new Map<string, { count: number; largest: bigint }>();

  async payerAttempts(payer: string): Promise<number> {
    return this.payer.get(payer.toLowerCase()) ?? 0;
  }
  async merchantAttempts(merchantId: string): Promise<number> {
    return this.merchant.get(merchantId) ?? 0;
  }
  async merchantPaid(merchantId: string, asset: AssetCode) {
    return this.paid.get(`${merchantId}:${asset}`) ?? { count: 0, largest: 0n };
  }
}

export class InMemoryDenylist implements Denylist {
  readonly #addresses = new Set<string>();
  add(address: string): void {
    this.#addresses.add(address.toLowerCase());
  }
  async has(address: string): Promise<boolean> {
    return this.#addresses.has(address.toLowerCase());
  }
}

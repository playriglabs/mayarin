/**
 * Merchant settings routes (#95).
 *
 * Mounted behind `require-auth` + `requirePermission("settings:manage")`. The
 * merchant being read or written is always the one on the session — no route
 * here takes a merchant id, so there is nothing to tamper with.
 */

import type { ChainId } from "@mayarin/chain";
import { UnauthorizedError, ValidationError } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import {
  historyQuerySchema,
  toSettingChangeDto,
  toSettingsDto,
  updateSettingsBodySchema,
} from "../dto/settings.ts";
import { csrfMiddleware } from "../middleware/csrf.ts";
import type { AuthVars } from "../middleware/types.ts";
import { settlementChains } from "../rails.ts";

export function settingsRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  /**
   * Where the merchant is actually paid, for display.
   *
   * Answers "and if I leave the address blank?" with the rule the order signer
   * applies, rather than a second guess at it. Resolved on the deployment's
   * wallet chain, which is the chain a managed wallet exists on.
   */
  const effectiveAddress = (merchantId: string, configured: string | undefined) =>
    container.settlementAddresses.effective(
      merchantId,
      container.config.walletProvisionChain,
      configured,
    );

  /**
   * Refuses a settlement address that exists on some chains and not others (#244).
   *
   * `merchants.settlement_address` is one value that wins on **every** chain, so
   * a Safe deployed on Base is otherwise paid to the same address on Arc, where
   * it has no code: the payment settles, and the money is at an address nobody
   * can spend from. An address with code nowhere is an EOA — the same key
   * controls it everywhere — and passes.
   *
   * Checked at the save rather than only at the payment, because a payout
   * address discovered to be wrong months later is a mistake with nothing left
   * to point at the person who made it.
   */
  async function assertAddressExistsEverywhere(address: string): Promise<void> {
    const code = container.contractCode;
    if (code === undefined) return;

    const chains = settlementChains(container.config);
    const withCode: ChainId[] = [];
    const withoutCode: ChainId[] = [];
    for (const chain of chains) {
      ((await code.hasCode(chain, address)) ? withCode : withoutCode).push(chain);
    }

    if (withCode.length === 0 || withoutCode.length === 0) return;

    throw new ValidationError(
      `${address} is a contract on ${withCode.join(", ")} and has no code on ${withoutCode.join(", ")}. ` +
        "A contract does not exist on a chain it was not deployed to, so paying it there would strand the funds. " +
        "Deploy it on every network you take payment on, or use an address you hold the key to.",
      { settlementAddress: address, deployedOn: withCode, missingOn: withoutCode },
    );
  }

  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const merchant = await container.settings.get(scope);
    const effective = await effectiveAddress(merchant.id, merchant.settlementAddress);
    return c.json({ settings: toSettingsDto(merchant, effective) });
  });

  // CSRF-guarded like every other state-changing route: this one decides where
  // the merchant's money is paid, so a forged cross-site form must not reach it.
  app.patch("/", csrfMiddleware(), async (c) => {
    const scope = c.get("scope");
    const session = c.get("session");
    if (scope === undefined || session === undefined) {
      throw new UnauthorizedError("Authentication required");
    }

    const body = updateSettingsBodySchema.parse(await c.req.json());
    if (typeof body.settlementAddress === "string") {
      await assertAddressExistsEverywhere(body.settlementAddress.trim().toLowerCase());
    }

    const { merchant, changes } = await container.settings.update(scope, session.user.id, {
      ...(body.settlementAsset === undefined ? {} : { settlementAsset: body.settlementAsset }),
      ...(body.acceptedAssets === undefined ? {} : { acceptedAssets: body.acceptedAssets }),
      ...(body.acceptedAssetsByChain === undefined
        ? {}
        : { acceptedAssetsByChain: body.acceptedAssetsByChain }),
      ...(body.settlementAddress === undefined
        ? {}
        : { settlementAddress: body.settlementAddress }),
      ...(body.city === undefined ? {} : { city: body.city }),
      ...(body.countryCode === undefined ? {} : { countryCode: body.countryCode }),
    });

    return c.json({
      settings: toSettingsDto(
        merchant,
        await effectiveAddress(merchant.id, merchant.settlementAddress),
      ),
      changes: changes.map(toSettingChangeDto),
    });
  });

  /** Who changed what, and when. Scoped to the caller's own merchant. */
  app.get("/history", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const { limit } = historyQuerySchema.parse(c.req.query());
    const changes = await container.settings.history(scope, limit);
    return c.json({ changes: changes.map(toSettingChangeDto) });
  });

  return app;
}

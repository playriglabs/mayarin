/**
 * Dashboard API config tests.
 *
 * The case that motivated them: `.env.example` lists every key it documents, and
 * the ones a deployment does not use are listed blank. Zod reads `""` as present,
 * so `.optional()` never applies — and the dashboard API refused to boot on
 * variables it was not using. `.env.example` could not boot the app it documents.
 */

import { describe, expect, test } from "bun:test";
import { ConfigurationError } from "@mayarin/shared";
import { loadConfig } from "../src/config.ts";

const MINIMAL = { DATABASE_URL: "postgres://mayarin:mayarin@localhost:5433/mayarin" };

describe("loadConfig", () => {
  test("a blank variable means unset, not set to nothing", async () => {
    const config = loadConfig({
      ...MINIMAL,
      WALLET_PROVISIONING_ENABLED: "false",
      WALLET_PROVISION_RPC_URL: "",
      WALLET_DEPLOYER_PRIVATE_KEY: "",
      TURNKEY_ORGANIZATION_ID: "",
      TREASURY_ADDRESS: "",
    });

    expect(config.walletProvisionRpcUrl).toBeUndefined();
    expect(config.walletDeployerPrivateKey).toBeUndefined();
    expect(config.turnkeyOrganizationId).toBeUndefined();
    expect(config.treasuryAddress).toBeUndefined();
  });

  test("a genuinely missing key is still refused", async () => {
    // Collapsing `""` to `undefined` must not turn a required key into an
    // optional one — it only stops an unused key failing on its length.
    expect(() => loadConfig({ DATABASE_URL: "" })).toThrow(ConfigurationError);
  });

  test("provisioning switched on still needs every credential", async () => {
    // Blank is unset, and unset is exactly what this check exists to catch: half
    // configured provisioning deploys with a key nobody meant, and the merchant
    // finds out when their money is meant to arrive.
    expect(() =>
      loadConfig({
        ...MINIMAL,
        WALLET_PROVISIONING_ENABLED: "true",
        WALLET_PROVISION_RPC_URL: "",
        WALLET_DEPLOYER_PRIVATE_KEY: "",
      }),
    ).toThrow(/WALLET_PROVISION_RPC_URL/);
  });
});

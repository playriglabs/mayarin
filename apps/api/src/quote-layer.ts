/**
 * Quote-layer assembly for the composition root (RFC #6/#7, #41).
 *
 * Builds the venue set, the reference oracle, the quote engine and the order
 * signer from configuration. It lives beside `container.ts` rather than inside
 * it because the quote layer has more branches than the rest of the container
 * put together — three venues, two oracles, two signers — and folding that into
 * `createContainer` would bury the composition everything else is trying to
 * make obvious.
 *
 * Everything here is still composition: it names concrete adapters, and nothing
 * below it does.
 */

import { FallbackPriceSource, type PriceOracle, type PriceSource } from "@mayarin/clearing";
import { priceSourceOf, type SwapVenue } from "@mayarin/execution";
import { ChainlinkPriceOracle } from "@mayarin/provider-chainlink";
import { CoinbasePriceOracle } from "@mayarin/provider-coinbase";
import { AwsKmsOrderSigner, LocalOrderSigner } from "@mayarin/provider-evm";
import { FxRatesPriceOracle } from "@mayarin/provider-fx";
import { PythPriceOracle } from "@mayarin/provider-pyth";
import { ZeroExSwapVenue } from "@mayarin/provider-swap-0x";
import { LifiSwapVenue } from "@mayarin/provider-swap-lifi";
import { UniswapSwapVenue } from "@mayarin/provider-swap-uniswap";
import { UniswapV2SwapVenue } from "@mayarin/provider-swap-uniswap-v2";
import { ApiKeyStamper, TurnkeyOrderSigner } from "@mayarin/provider-turnkey";
import { FallbackPriceOracle, isFxMarketOpen, type OrderSigner, QuoteEngine } from "@mayarin/quote";
import { type AssetCode, type Clock, ConfigurationError, getAsset } from "@mayarin/shared";
import type { Config, OracleName } from "./config.ts";

export interface QuoteLayer {
  readonly engine: QuoteEngine;
  /** In configured order, which is also the tie-break order for venue selection. */
  readonly venues: readonly SwapVenue[];
  readonly oracle: PriceOracle;
  readonly signer: OrderSigner;
  readonly slippageBps: number;
  readonly ttlSeconds: number;
}

/** Builds the quote layer, or nothing when `QUOTE_ENABLED` is false. */
export function createQuoteLayer(config: Config, clock: Clock): QuoteLayer | undefined {
  const quote = config.quote;
  if (quote === undefined) {
    return undefined;
  }

  const venues = quote.venues.map((name) => createVenue(name, config));
  const oracle = createOracle(config, clock);

  return {
    // The engine prices against the venues in configured order, taking the
    // first that can price the payment's chain. Pricing against the first venue
    // full stop was wrong the moment a second chain existed: a V3 pool on Base
    // priced payments on Arc, and the lock carried a rate from a pool the swap
    // would never touch. `selectVenue` (#48) still picks the execution venue
    // per payment; this only decides who is allowed to price.
    engine: new QuoteEngine({
      venue: venuesAsPriceSource(venues),
      oracle,
      policy: {
        maxDeviationBps: quote.deviationBps,
        maxAgeMs: quote.maxReferenceAgeSeconds * 1_000,
      },
      unguardedTestnetPairs: quote.unguardedTestnetPairs,
      fiat: {
        pegged: quote.peggedPairs,
        maxAgeMs: quote.fxMaxAgeSeconds * 1_000,
        closedMaxAgeMs: quote.fxClosedMaxAgeSeconds * 1_000,
        closedSpreadBps: quote.fxClosedSpreadBps,
      },
      clock,
    }),
    venues,
    oracle,
    signer: createSigner(config),
    slippageBps: quote.slippageBps,
    ttlSeconds: quote.ttlSeconds,
  };
}

function venuesAsPriceSource(venues: readonly SwapVenue[]): PriceSource {
  if (venues.length === 0) {
    // Unreachable: `resolveQuote` rejects an empty venue list at boot. Kept as a
    // type-level narrowing rather than a non-null assertion, which Biome bans.
    throw new ConfigurationError("The quote layer needs at least one venue", {});
  }
  return new FallbackPriceSource(venues.map(priceSourceOf));
}

function createVenue(name: string, config: Config): SwapVenue {
  switch (name) {
    case "0x":
      return new ZeroExSwapVenue({
        pairs: config.zeroExPairs as never,
        chainId: config.zeroExChainId ?? 0,
        apiKey: config.zeroExApiKey ?? "",
      });
    case "uniswap":
      return new UniswapSwapVenue({
        rpcUrls: config.chainRpcUrls,
        quoters: config.uniswapQuoters,
        pools: config.uniswapPools as never,
      });
    case "uniswap-v2":
      return new UniswapV2SwapVenue({
        rpcUrls: config.chainRpcUrls,
        routers: config.uniswapV2Routers,
        pairs: config.uniswapV2Pairs as never,
      });
    case "lifi":
      return new LifiSwapVenue({
        pairs: config.lifiPairs as never,
        fromAddress: config.lifiFromAddress ?? "",
        ...(config.lifiApiKey === undefined ? {} : { apiKey: config.lifiApiKey }),
      });
    default:
      throw new ConfigurationError(`Unsupported quote venue "${name}"`, { venue: name });
  }
}

function createOracle(config: Config, clock: Clock): PriceOracle {
  const quote = config.quote;
  if (quote === undefined) {
    throw new ConfigurationError("The oracle requires an enabled quote layer", {});
  }

  const names = [quote.oracle, ...quote.fallbackOracles];
  const sources = names.map((name) => ({ name, oracle: createOracleSource(name, config, clock) }));
  const only = sources.length === 1 ? sources[0] : undefined;
  if (only !== undefined) return only.oracle;

  return new FallbackPriceOracle({
    sources,
    clock,
    maxAgeMs: (from, _to, now) => referenceMaxAgeMs(from, now, quote),
    // The oracle-agreement bound, not the venue one: see `quoteOracleAgreementBps`.
    maxDeviationBps: quote.oracleAgreementBps,
  });
}

function createOracleSource(name: OracleName, config: Config, clock: Clock): PriceOracle {
  switch (name) {
    case "pyth":
      return new PythPriceOracle({
        feeds: config.pythFeeds,
        ...(config.pythHermesEndpoint !== undefined && { endpoint: config.pythHermesEndpoint }),
        ...(config.pythApiKey !== undefined && { apiKey: config.pythApiKey }),
      });
    case "fx":
      return new FxRatesPriceOracle({
        feeds: config.fxFeeds,
        clock,
        ...(config.fxEndpoint !== undefined && { endpoint: config.fxEndpoint }),
        ...(config.fxApiKey !== undefined && { apiKey: config.fxApiKey }),
      });
    case "coinbase":
      return new CoinbasePriceOracle({
        feeds: config.coinbaseProducts,
        clock,
        ...(config.coinbaseEndpoint !== undefined && { endpoint: config.coinbaseEndpoint }),
      });
    case "chainlink":
      return new ChainlinkPriceOracle({
        rpcUrls: config.chainRpcUrls,
        feeds: config.chainlinkFeeds,
      });
  }
}

function referenceMaxAgeMs(
  from: AssetCode,
  now: Date,
  quote: NonNullable<Config["quote"]>,
): number {
  if (getAsset(from).kind !== "fiat") return quote.maxReferenceAgeSeconds * 1_000;
  return (isFxMarketOpen(now) ? quote.fxMaxAgeSeconds : quote.fxClosedMaxAgeSeconds) * 1_000;
}

function createSigner(config: Config): OrderSigner {
  if (config.quoteSigner === "local") {
    // `resolveQuote` has already refused this for every mainnet router.
    return new LocalOrderSigner((config.quoteSignerPrivateKey ?? "0x") as `0x${string}`);
  }
  if (config.quoteSigner === "aws-kms") {
    return new AwsKmsOrderSigner({
      keyId: config.awsKmsKeyId ?? "",
      region: config.awsKmsRegion ?? "",
      signerAddress: (config.awsKmsSignerAddress ?? "0x") as `0x${string}`,
    });
  }
  return new TurnkeyOrderSigner({
    organizationId: config.turnkeyOrganizationId ?? "",
    signWith: config.turnkeySignWith ?? "",
    signerAddress: (config.turnkeySignerAddress ?? "0x") as `0x${string}`,
    stamper: new ApiKeyStamper({
      apiPublicKey: config.turnkeyApiPublicKey ?? "",
      apiPrivateKey: config.turnkeyApiPrivateKey ?? "",
    }),
  });
}

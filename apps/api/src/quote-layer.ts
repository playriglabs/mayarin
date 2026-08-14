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

import type { PriceOracle, PriceSource } from "@mayarin/clearing";
import { priceSourceOf, type SwapVenue } from "@mayarin/execution";
import { ChainlinkPriceOracle } from "@mayarin/provider-chainlink";
import { AwsKmsOrderSigner, LocalOrderSigner } from "@mayarin/provider-evm";
import { PythPriceOracle } from "@mayarin/provider-pyth";
import { ZeroExSwapVenue } from "@mayarin/provider-swap-0x";
import { LifiSwapVenue } from "@mayarin/provider-swap-lifi";
import { UniswapSwapVenue } from "@mayarin/provider-swap-uniswap";
import { ApiKeyStamper, TurnkeyOrderSigner } from "@mayarin/provider-turnkey";
import { FallbackPriceOracle, isFxMarketOpen, type OrderSigner, QuoteEngine } from "@mayarin/quote";
import { type AssetCode, type Clock, ConfigurationError, getAsset } from "@mayarin/shared";
import type { Config } from "./config.ts";

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
    // The engine prices against the *first* venue rather than the selected one:
    // `selectVenue` (#48) picks a venue per payment, and threading that through
    // is the calldata builder's job (#49/#57), not the engine's. Composing here
    // gives the deviation guard a live source instead of the static table.
    engine: new QuoteEngine({
      venue: firstVenueAsPriceSource(venues),
      oracle,
      policy: {
        maxDeviationBps: quote.deviationBps,
        maxAgeMs: quote.maxReferenceAgeSeconds * 1_000,
      },
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

function firstVenueAsPriceSource(venues: readonly SwapVenue[]): PriceSource {
  const venue = venues[0];
  if (venue === undefined) {
    // Unreachable: `resolveQuote` rejects an empty venue list at boot. Kept as a
    // type-level narrowing rather than a non-null assertion, which Biome bans.
    throw new ConfigurationError("The quote layer needs at least one venue", {});
  }
  return priceSourceOf(venue);
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
  const sources = names.map((name) => ({ name, oracle: createOracleSource(name, config) }));
  const only = sources.length === 1 ? sources[0] : undefined;
  if (only !== undefined) return only.oracle;

  return new FallbackPriceOracle({
    sources,
    clock,
    maxAgeMs: (from, _to, now) => referenceMaxAgeMs(from, now, quote),
    maxDeviationBps: quote.deviationBps,
  });
}

function createOracleSource(name: "pyth" | "chainlink", config: Config): PriceOracle {
  switch (name) {
    case "pyth":
      return new PythPriceOracle({ feeds: config.pythFeeds });
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

/**
 * Gas refiller: keeps the operator's native balance above its floor.
 *
 * The operator pays gas in the chain's own currency, while what payers reimburse
 * (the gas share of every fee) lands in the treasury Safe as a stablecoin. This
 * closes that loop without a person: when the operator's native balance is under
 * its floor, it pulls a fixed amount of the stablecoin from the Safe through the
 * Safe Allowance Module and swaps it to native through LiFi.
 *
 * What bounds a compromise is the Safe, not this code. The operator is a delegate
 * with an allowance of one token, capped per period, and the Safe's owners can
 * revoke it. The most this service can move is that allowance.
 *
 * Idempotent, and the chain is the only state. A pass that crashes after the pull
 * leaves the stablecoin on the operator, and the next pass swaps it instead of
 * pulling again.
 */

import { type ChainId, toChainUnits } from "@mayarin/chain";
import { type AssetCode, ConfigurationError, fromDecimalString } from "@mayarin/shared";
import {
  type Address,
  encodeFunctionData,
  getAddress,
  parseAbi,
  parseEther,
  zeroAddress,
} from "viem";
import { z } from "zod";

/** The Safe Allowance Module 0.1.0, at the same address on every chain we run. */
export const ALLOWANCE_MODULE = "0xCFbFaC74C26F8647cBDb8c5caf80BB5b32E43134";

/** LiFi's diamond, at the same address on every chain (docs/chain.md). */
export const LIFI_DIAMOND = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE";

export const allowanceModuleAbi = parseAbi([
  "function executeAllowanceTransfer(address safe, address token, address to, uint96 amount, address paymentToken, uint96 payment, address delegate, bytes signature)",
  "function getTokenAllowance(address safe, address delegate, address token) view returns (uint256[5])",
]);

const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
]);

export interface GasRefillChain {
  /** The stablecoin pulled from the Safe, which is also what is swapped. */
  readonly asset: AssetCode;
  /** Whole units of `asset` per refill, as a decimal string. */
  readonly amount: string;
  /** The native floor, in whole units; a balance under it triggers a refill. */
  readonly min: string;
}

/** What a refill needs from the chain: reads, and one sender that waits for its receipt. */
export interface GasRefillChainPort {
  nativeBalance(chain: ChainId, holder: Address): Promise<bigint>;
  /** Reads a view call and returns the decoded result. */
  read(chain: ChainId, to: Address, data: `0x${string}`): Promise<`0x${string}`>;
  /** Sends one call from the operator and waits for it; throws on a revert. */
  send(chain: ChainId, to: Address, data: `0x${string}`): Promise<string>;
}

export interface GasRefillerOptions {
  readonly chains: Readonly<Partial<Record<ChainId, GasRefillChain>>>;
  readonly port: GasRefillChainPort;
  /** Token address per chain and asset. */
  readonly tokens: Readonly<Partial<Record<ChainId, Partial<Record<AssetCode, string>>>>>;
  /** The Safe the stablecoin is pulled from. */
  readonly safe: Address;
  /** The operator: the delegate, the one that holds the stablecoin, the one that is refilled. */
  readonly operator: Address;
  /** The swap from the stablecoin to the chain's native currency. */
  readonly route: (request: {
    chain: ChainId;
    token: Address;
    amountIn: bigint;
    taker: Address;
  }) => Promise<GasRefillRoute>;
}

export interface GasRefillRoute {
  readonly to: string;
  readonly data: `0x${string}`;
  /** Native sent with the call; a stablecoin swap sends none. */
  readonly value: bigint;
  readonly approvalAddress: string | undefined;
  /** What the route guarantees after its own slippage, in wei. */
  readonly toAmountMin: bigint;
}

export interface GasRefillFinding {
  readonly type: "gas-refill";
  readonly chain: ChainId;
  readonly result: "refilled" | "allowance-exhausted" | "safe-empty" | "failed";
  readonly detail?: string;
}

export class GasRefiller {
  readonly #options: GasRefillerOptions;

  constructor(options: GasRefillerOptions) {
    for (const [chain, entry] of Object.entries(options.chains)) {
      if (entry === undefined) continue;
      if (options.tokens[chain as ChainId]?.[entry.asset] === undefined) {
        throw new ConfigurationError(
          `GAS_REFILL names ${entry.asset} on ${chain}, which has no token address`,
          {
            chain,
            asset: entry.asset,
          },
        );
      }
    }
    this.#options = options;
  }

  /** One pass over every configured chain. A chain that fails is reported, not thrown. */
  async run(): Promise<GasRefillFinding[]> {
    const findings: GasRefillFinding[] = [];
    for (const [chain, entry] of Object.entries(this.#options.chains)) {
      if (entry === undefined) continue;
      try {
        const finding = await this.#refill(chain as ChainId, entry);
        if (finding !== undefined) findings.push(finding);
      } catch (error) {
        findings.push({
          type: "gas-refill",
          chain: chain as ChainId,
          result: "failed",
          detail: error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error),
        });
      }
    }
    return findings;
  }

  async #refill(chain: ChainId, entry: GasRefillChain): Promise<GasRefillFinding | undefined> {
    const { port, safe, operator } = this.#options;
    if ((await port.nativeBalance(chain, operator)) >= parseEther(entry.min)) return undefined;

    const token = getAddress(this.#options.tokens[chain]?.[entry.asset] ?? "");
    const amount = toChainUnits(
      chain,
      entry.asset,
      fromDecimalString(entry.amount, entry.asset).amount,
    );

    const held = await this.#balance(chain, token, operator);
    if (held < amount) {
      const [allowed, spent] = await this.#moduleAllowance(chain, token);
      if (allowed - spent < amount)
        return { type: "gas-refill", chain, result: "allowance-exhausted" };
      if ((await this.#balance(chain, token, safe)) < amount) {
        return { type: "gas-refill", chain, result: "safe-empty" };
      }
      await port.send(
        chain,
        ALLOWANCE_MODULE,
        encodeFunctionData({
          abi: allowanceModuleAbi,
          functionName: "executeAllowanceTransfer",
          // An empty signature authenticates the caller: the operator is the delegate.
          args: [safe, token, operator, amount, zeroAddress, 0n, operator, "0x"],
        }),
      );
    }

    await this.#swap(chain, token, amount);
    return { type: "gas-refill", chain, result: "refilled" };
  }

  async #swap(chain: ChainId, token: Address, amount: bigint): Promise<void> {
    const { port, operator } = this.#options;
    const route = await this.#options.route({ chain, token, amountIn: amount, taker: operator });

    // The route is another party's calldata run by a hot key: it may call LiFi's
    // diamond only, spend only the approval it names, and must deliver something.
    if (route.to.toLowerCase() !== LIFI_DIAMOND.toLowerCase()) {
      throw new ConfigurationError(`The refill route calls ${route.to}, not LiFi's diamond`, {
        chain,
      });
    }
    if (
      route.approvalAddress !== undefined &&
      route.approvalAddress.toLowerCase() !== route.to.toLowerCase()
    ) {
      throw new ConfigurationError(
        `The refill route wants an approval to ${route.approvalAddress}`,
        { chain },
      );
    }
    if (route.value !== 0n || route.toAmountMin <= 0n) {
      throw new ConfigurationError("The refill route sends native or delivers nothing", { chain });
    }

    const allowance = decodeUint(
      await port.read(
        chain,
        token,
        encodeFunctionData({
          abi: erc20Abi,
          functionName: "allowance",
          args: [operator, getAddress(route.to)],
        }),
      ),
    );
    if (allowance < amount) {
      await port.send(
        chain,
        token,
        encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [getAddress(route.to), amount],
        }),
      );
    }
    await port.send(chain, getAddress(route.to), route.data);
  }

  async #balance(chain: ChainId, token: Address, holder: Address): Promise<bigint> {
    return decodeUint(
      await this.#options.port.read(
        chain,
        token,
        encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [holder] }),
      ),
    );
  }

  /** `[allowed, spent]` for the operator on the Safe's allowance, after any period reset. */
  async #moduleAllowance(chain: ChainId, token: Address): Promise<readonly [bigint, bigint]> {
    const { port, safe, operator } = this.#options;
    const raw = await port.read(
      chain,
      ALLOWANCE_MODULE,
      encodeFunctionData({
        abi: allowanceModuleAbi,
        functionName: "getTokenAllowance",
        args: [safe, operator, token],
      }),
    );
    // uint256[5] = [amount, spent, resetTimeMin, lastResetMin, nonce], one word each.
    const words = z
      .string()
      .regex(/^0x[0-9a-f]{320}$/i)
      .parse(raw);
    return [BigInt(`0x${words.slice(2, 66)}`), BigInt(`0x${words.slice(66, 130)}`)];
  }
}

function decodeUint(raw: `0x${string}`): bigint {
  return BigInt(raw);
}

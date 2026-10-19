/**
 * Whether a router will pay a destination (SEC-06).
 *
 * A router whose destination registry is enforced reverts any order to an
 * unregistered `merchantSafe`, and the payer pays gas for that revert. Asking
 * before the order is signed turns it into a refusal at lock time, with a reason
 * a person can act on.
 *
 * A router without the registry (deployed before it existed) has no such
 * function. That reads as not enforced, but only for the errors a missing
 * function produces: an RPC that is down is an error, never a pass, so an outage
 * cannot switch the check off.
 */

import { type ChainId, isChainId } from "@mayarin/chain";
import { type Clock, ConfigurationError } from "@mayarin/shared";
import { type Address, createPublicClient, http, type PublicClient, parseAbi } from "viem";

const REGISTRY_ABI = parseAbi([
  "function merchantRegistryEnforced() view returns (bool)",
  "function isMerchantSafeRegistered(address safe) view returns (bool)",
]);

/** The errors viem raises for a function the contract does not have. */
const ABSENT_FUNCTION = new Set(["ContractFunctionRevertedError", "ContractFunctionZeroDataError"]);

export interface MerchantRegistry {
  /** Throws if the chain's router enforces a registry and `safe` is not in it. */
  assertPayable(chain: ChainId, safe: string): Promise<void>;
}

export interface MerchantRegistryOptions {
  readonly rpcUrls: Readonly<Partial<Record<string, string>>>;
  readonly routers: Readonly<Partial<Record<ChainId, string>>>;
  readonly clock: Clock;
  /** How long a chain's "enforced or not" answer is kept. Enforcement changes through a timelock. */
  readonly ttlMs?: number;
  /** Injected for tests; defaults to a read over the chain's RPC. */
  readonly read?: (
    chain: ChainId,
    router: string,
    functionName: "merchantRegistryEnforced" | "isMerchantSafeRegistered",
    args: readonly string[],
  ) => Promise<boolean>;
}

export function rpcMerchantRegistry(options: MerchantRegistryOptions): MerchantRegistry {
  const ttlMs = options.ttlMs ?? 60_000;
  const clients = new Map<string, PublicClient>();
  const enforcement = new Map<ChainId, { enforced: boolean; at: number }>();

  const read =
    options.read ??
    (async (chain, router, functionName, args) => {
      const rpcUrl = isChainId(chain) ? options.rpcUrls[chain] : undefined;
      if (rpcUrl === undefined) {
        throw new ConfigurationError(`No RPC URL configured for ${chain}`, { chain });
      }
      let client = clients.get(chain);
      if (client === undefined) {
        client = createPublicClient({ transport: http(rpcUrl) });
        clients.set(chain, client);
      }
      const base = { address: router as Address, abi: REGISTRY_ABI } as const;
      return functionName === "merchantRegistryEnforced"
        ? client.readContract({ ...base, functionName })
        : client.readContract({ ...base, functionName, args: [args[0] as Address] });
    });

  const enforcedOn = async (chain: ChainId, router: string): Promise<boolean> => {
    const now = options.clock.now().getTime();
    const known = enforcement.get(chain);
    if (known !== undefined && now - known.at < ttlMs) return known.enforced;
    let enforced: boolean;
    try {
      enforced = await read(chain, router, "merchantRegistryEnforced", []);
    } catch (error) {
      if (!isAbsentFunction(error)) throw error;
      enforced = false;
    }
    enforcement.set(chain, { enforced, at: now });
    return enforced;
  };

  return {
    async assertPayable(chain, safe) {
      const router = options.routers[chain];
      if (router === undefined || !(await enforcedOn(chain, router))) return;
      if (await read(chain, router, "isMerchantSafeRegistered", [safe])) return;
      throw new ConfigurationError(
        `${safe} is not registered on the ${chain} PaymentRouter, which only pays registered destinations. ` +
          "Register it (scripts/register-merchant-safe.ts) before this payment can be locked",
        { chain, safe },
      );
    },
  };
}

function isAbsentFunction(error: unknown): boolean {
  for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
    if (ABSENT_FUNCTION.has(cause.name)) return true;
  }
  return false;
}

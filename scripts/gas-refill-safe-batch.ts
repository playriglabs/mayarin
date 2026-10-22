/**
 * The Safe transactions that let the gas refiller work, one Transaction Builder file per chain.
 *
 *   bun --env-file=.env.mainnet scripts/gas-refill-safe-batch.ts [outDir]
 *
 * Each file holds three calls from the treasury Safe, for its owners to import into the Safe
 * app, sign (2-of-3) and execute:
 *
 *   1. `enableModule`  - the Safe Allowance Module may move the Safe's tokens
 *   2. `addDelegate`   - the operator may ask it to
 *   3. `setAllowance`  - for the chain's stablecoin only, `ALLOWANCE_REFILLS` refills per 24 h
 *
 * The allowance is the bound on the whole automation: a compromised operator can take that
 * much per day and no more, and the owners can delete it with one Safe transaction.
 * Nothing here signs or sends.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { type ChainId, evmChainIdOf, toChainUnits } from "@mayarin/chain";
import { fromDecimalString } from "@mayarin/shared";
import { encodeFunctionData, getAddress, parseAbi } from "viem";
import { loadConfig } from "../apps/api/src/config.ts";
import { ALLOWANCE_MODULE } from "../apps/api/src/services/gas-refiller.ts";

/** How many refills a day the Safe allows. */
const ALLOWANCE_REFILLS = 4;
const DAY_MINUTES = 1_440;

const safeAbi = parseAbi(["function enableModule(address module)"]);
const moduleAbi = parseAbi([
  "function addDelegate(address delegate)",
  "function setAllowance(address delegate, address token, uint96 allowanceAmount, uint16 resetTimeMin, uint32 resetBaseMin)",
]);

// The database is never opened here; the config just refuses to load without a URL.
const config = loadConfig({ ...process.env, DATABASE_URL: "postgres://unused" }, "worker");
const outDir = process.argv[2] ?? ".";
if (config.treasuryAddress === undefined || config.operatorAddress === undefined) {
  throw new Error("TREASURY_ADDRESS and OPERATOR_ADDRESS are required");
}
const safe = getAddress(config.treasuryAddress);
const operator = getAddress(config.operatorAddress);

mkdirSync(outDir, { recursive: true });
for (const [chain, entry] of Object.entries(config.gasRefill)) {
  const token = config.stablecoins
    .filter((coin) => coin.asset === entry.asset)
    .flatMap((coin) => coin.onChain)
    .find((onChain) => onChain.chain === chain)?.address;
  if (token === undefined) throw new Error(`No ${entry.asset} token address on ${chain}`);

  const allowance =
    toChainUnits(
      chain as ChainId,
      entry.asset as never,
      fromDecimalString(entry.amount, entry.asset as never).amount,
    ) * BigInt(ALLOWANCE_REFILLS);

  const calls = [
    {
      to: safe,
      data: encodeFunctionData({
        abi: safeAbi,
        functionName: "enableModule",
        args: [ALLOWANCE_MODULE],
      }),
    },
    {
      to: ALLOWANCE_MODULE,
      data: encodeFunctionData({ abi: moduleAbi, functionName: "addDelegate", args: [operator] }),
    },
    {
      to: ALLOWANCE_MODULE,
      data: encodeFunctionData({
        abi: moduleAbi,
        functionName: "setAllowance",
        args: [operator, getAddress(token), allowance, DAY_MINUTES, 0],
      }),
    },
  ];

  const file = `${outDir}/gas-refill-${chain}.json`;
  writeFileSync(
    file,
    JSON.stringify(
      {
        version: "1.0",
        chainId: evmChainIdOf(chain as ChainId).toString(),
        createdAt: Date.now(),
        meta: {
          name: `Gas refill allowance (${chain})`,
          description: `${entry.asset} ${allowance} per day to ${operator}`,
        },
        transactions: calls.map((call) => ({
          to: call.to,
          value: "0",
          data: call.data,
          contractMethod: null,
          contractInputsValues: null,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`${chain}: ${file} (allowance ${allowance} base units of ${entry.asset} per day)`);
}

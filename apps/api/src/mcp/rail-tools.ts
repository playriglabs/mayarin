/**
 * What the MCP server actually sells (#231).
 *
 * Two tools over one question: which of Mayarin's payment rails has been
 * settling with room to spare, and which one should this agent pay on. Both
 * answers come from the settlements subgraph through `RailObservationSource`,
 * and both do work on the data rather than handing back a query result — a
 * median over the last hundred settlements, the tail the median hides, and a
 * ranked choice with the reason attached.
 *
 * **Neither tool queries The Graph itself.** The source is the same cached
 * observer `paymentRequired` reads, deliberately: Subgraph Studio allows 3,000
 * queries a day *account-wide*, so a pay-per-query tool wired straight through
 * hands anyone who can pay a way to spend the deployment's whole budget. Every
 * call inside the cache window costs nothing, and the number being sold — a
 * median over a hundred settlements — does not move between two requests a
 * second apart.
 */

import { type ChainId, isChainId } from "@mayarin/chain";
import { ValidationError } from "@mayarin/shared";
import { chooseRail, type RailObservationSource, summariseRails } from "@mayarin/x402";
import { z } from "zod";
import { type McpTool, toolResult } from "./protocol.ts";

/**
 * Refused by name rather than silently narrowed.
 *
 * An agent that asks about a chain this deployment has never heard of has made a
 * mistake worth telling it about; dropping the unknown entries would answer a
 * question it did not ask.
 */
const chainsSchema = z
  .array(z.string())
  .min(1)
  .superRefine((chains, ctx) => {
    const unknown = chains.filter((chain) => !isChainId(chain));
    if (unknown.length > 0) {
      ctx.addIssue({ code: "custom", message: `unknown chains: ${unknown.join(", ")}` });
    }
  })
  .transform((chains) => chains.filter((chain): chain is ChainId => isChainId(chain)));

const chainsProperty = {
  type: "array",
  items: { type: "string" },
  minItems: 1,
  description: "Chain ids to consider, e.g. base-sepolia, arc-testnet.",
};

export const RAIL_TOOLS: readonly McpTool[] = [
  {
    name: "rail_stats",
    title: "Rail settlement statistics",
    description:
      "How each payment rail has actually been settling: sample count, median headroom in seconds, and the worst and best observed. Headroom is the seconds an order had left before its deadline when it landed, so a low minimum is a rail about to start reverting.",
    inputSchema: {
      type: "object",
      properties: { chains: chainsProperty },
      required: ["chains"],
      additionalProperties: false,
    },
  },
  {
    name: "choose_rail",
    title: "Choose a payment rail",
    description:
      "Rank the given rails by median headroom and return the one to pay on, with the reason in one line. Says so explicitly when no rail has enough observed settlements to rank, rather than presenting the first one as a decision.",
    inputSchema: {
      type: "object",
      properties: {
        chains: chainsProperty,
        minSamples: {
          type: "integer",
          minimum: 1,
          description: "Settlements a rail needs before it is ranked at all. Defaults to 5.",
        },
      },
      required: ["chains"],
      additionalProperties: false,
    },
  },
];

const railStatsArgsSchema = z.object({ chains: chainsSchema });
const chooseRailArgsSchema = z.object({
  chains: chainsSchema,
  minSamples: z.number().int().min(1).optional(),
});

/**
 * Run one tool.
 *
 * Throws `ValidationError` for a name nobody serves or arguments that do not
 * parse; the route turns that into a tool error rather than a protocol one,
 * because the call did reach the tool.
 */
export async function runRailTool(
  name: string,
  args: Record<string, unknown>,
  observations: RailObservationSource,
): Promise<Record<string, unknown>> {
  if (name === "rail_stats") {
    const { chains } = parse(railStatsArgsSchema, args);
    const summaries = summariseRails(chains, await observe(observations, chains));
    return toolResult(summaries.map(describe).join("\n"), { rails: summaries });
  }

  if (name === "choose_rail") {
    const { chains, minSamples } = parse(chooseRailArgsSchema, args);
    const choice = chooseRail(
      chains,
      await observe(observations, chains),
      minSamples === undefined ? {} : { minSamples },
    );
    return toolResult(choice.reason, { ...choice });
  }

  throw new ValidationError(`No MCP tool named ${name}`, { name });
}

/**
 * Read the rails, and refuse rather than sell an answer with nothing behind it.
 *
 * `CachedRailObservations` degrades on an outage — it serves the last good read
 * or none at all, because a `402` still has to be answered. That is right for a
 * payment and wrong for a sale: charging an agent for "no rail has been observed"
 * is charging them for our own subgraph being down.
 *
 * So a read with no settlements anywhere throws before the payer is charged, and
 * the agent falls back on its own terms having paid nothing. That is also the
 * cleaner form of this RFC's deletion test: remove the subgraph and the agent
 * visibly falls back, rather than buying a shrug.
 */
async function observe(source: RailObservationSource, chains: readonly ChainId[]) {
  const observations = await source.observe(chains);
  if (observations.every((observation) => observation.headroomSeconds.length === 0)) {
    throw new ValidationError(
      `No settlements have been observed on ${chains.join(", ")}, so there is nothing to sell`,
      { chains },
    );
  }
  return observations;
}

function parse<S extends z.ZodType>(schema: S, args: Record<string, unknown>): z.output<S> {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join("; "), {
      args,
    });
  }
  return parsed.data;
}

/**
 * One rail in one line.
 *
 * A rail nobody has watched settle says so in words. Reporting it as `0s
 * headroom` would be a measurement, and there is no measurement.
 */
function describe(summary: ReturnType<typeof summariseRails>[number]): string {
  if (summary.samples === 0) return `${summary.chain}: no observed settlements`;
  return `${summary.chain}: median ${summary.medianHeadroomSeconds}s headroom over ${summary.samples} settlements, worst ${summary.minHeadroomSeconds}s, best ${summary.maxHeadroomSeconds}s`;
}

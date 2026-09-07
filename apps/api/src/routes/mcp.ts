/**
 * The Subgraph-backed MCP server, served behind x402 (#231).
 *
 * One HTTP endpoint speaking MCP over JSON-RPC. An agent connects, lists what is
 * for sale, calls a tool, receives a `402`, signs one authorization, and gets its
 * answer. No account, no API key, no dashboard.
 *
 * **Discovery is free and answers are paid**, and that line is the whole design.
 * `initialize` and `tools/list` cost nothing, because an agent has to know what
 * a tool does before it can decide the price is worth paying — a `402` on the
 * catalogue is a shop with the lights off. `tools/call` is where the work is and
 * where the charge is.
 *
 * **The tool runs before the payer is charged.** Same rule as `/x402/fx/quote`:
 * a resource server cannot un-serve a response, so a tool that is going to
 * refuse — unknown arguments, or no settlements observed at all — must refuse
 * before the authorization is spent. `exact` gives the payer one signature and
 * no way to get it back.
 */

import type { RailObservationSource } from "@mayarin/x402";
import { PAYMENT_SIGNATURE_HEADER } from "@mayarin/x402";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import {
  initializeResult,
  JSON_RPC_ERRORS,
  jsonRpcError,
  jsonRpcResult,
  type McpId,
  mcpRequestSchema,
  toolCallParamsSchema,
  toolError,
} from "../mcp/protocol.ts";
import { RAIL_TOOLS, runRailTool } from "../mcp/rail-tools.ts";
import { requirePayment } from "./x402.ts";

/**
 * The resource id the MCP tool call is registered under.
 *
 * Fixed in code for the same reason `FX_QUOTE_RESOURCE_ID` is: `requirePayment`
 * gates a route, and a gate whose id came from the environment would 404 for a
 * deployment that spelt it differently, with nothing on the payer's side saying
 * why.
 */
export const RAIL_MCP_RESOURCE_ID = "rail-intelligence";

/** The one method that costs money. Everything else here is discovery. */
const PAID_METHOD = "tools/call";

type McpEnv = { Variables: { mcpAnswer: Record<string, unknown>; mcpId: McpId } };

export function mcpRoutes(container: Container): Hono<McpEnv> {
  const app = new Hono<McpEnv>();
  const gate = requirePayment(container, RAIL_MCP_RESOURCE_ID);

  app.post(
    "/",
    async (c, next) => {
      const parsed = mcpRequestSchema.safeParse(await readBody(c.req.raw));
      if (!parsed.success) {
        return c.json(
          jsonRpcError(0, JSON_RPC_ERRORS.invalidRequest, "Not a JSON-RPC 2.0 request"),
        );
      }

      const { id, method, params } = parsed.data;
      // A notification carries no id and gets no response at all. Answering one
      // puts a reply on a wire nobody is reading.
      if (id === undefined) return c.body(null, 202);
      c.set("mcpId", id);

      if (method === "initialize") {
        c.set("mcpAnswer", initializeResult());
        return next();
      }
      if (method === "tools/list") {
        c.set("mcpAnswer", { tools: RAIL_TOOLS });
        return next();
      }
      if (method !== PAID_METHOD) {
        return c.json(jsonRpcError(id, JSON_RPC_ERRORS.methodNotFound, `Unknown method ${method}`));
      }

      const call = toolCallParamsSchema.safeParse(params ?? {});
      if (!call.success) {
        return c.json(jsonRpcError(id, JSON_RPC_ERRORS.invalidParams, "tools/call needs a name"));
      }

      const observations = container.railObservations;
      if (observations === undefined) {
        // Nothing to sell rather than a broken sale: this deployment has no
        // subgraph configured, so the tool does not exist here.
        c.set("mcpAnswer", toolError("This deployment has no rail observations configured"));
        return next();
      }

      // Before the gate, deliberately. See the header.
      const answer = await runTool(call.data.name, call.data.arguments, observations);
      c.set("mcpAnswer", answer);
      if ("isError" in answer) return next();
      // A free retry after a `402` has already been paid would be a free answer,
      // so the gate runs on every paid call rather than only the first.
      return gate(c, next);
    },
    (c) => c.json(jsonRpcResult(c.get("mcpId"), c.get("mcpAnswer"))),
  );

  /**
   * What this server is, for a human or an agent that arrived with a browser.
   *
   * Free, and it names the paid method rather than pricing it — the price comes
   * from the `402`, which is the only place it is authoritative.
   */
  app.get("/", (c) =>
    c.json({
      protocol: "mcp",
      transport: "http-jsonrpc",
      tools: RAIL_TOOLS.map((tool) => ({ name: tool.name, description: tool.description })),
      paid: [PAID_METHOD],
      free: ["initialize", "tools/list"],
      paymentHeader: PAYMENT_SIGNATURE_HEADER,
    }),
  );

  return app;
}

/**
 * A tool's own failure is a result, not a protocol error.
 *
 * The distinction is what tells a model whether retrying could ever work: a
 * JSON-RPC error means the call never reached the tool, and `isError` means it
 * did and the tool said no.
 */
async function runTool(
  name: string,
  args: Record<string, unknown>,
  observations: RailObservationSource,
): Promise<Record<string, unknown>> {
  try {
    return await runRailTool(name, args, observations);
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

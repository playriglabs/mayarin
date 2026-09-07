/**
 * The MCP wire format, with no idea what it is serving (#231).
 *
 * MCP is JSON-RPC 2.0 with four methods that matter to a server this small:
 * `initialize`, the `notifications/initialized` that acknowledges it,
 * `tools/list`, and `tools/call`. Everything here is pure — parsing a request,
 * shaping a result, shaping an error — so the transport can be tested without a
 * subgraph and the tools can be tested without HTTP.
 *
 * **A notification carries no `id` and gets no response.** That is not a detail
 * to smooth over: answering one puts a reply on the wire the client is not
 * reading, and a client that sent `notifications/initialized` is already waiting
 * on something else.
 */

import { z } from "zod";

/**
 * The revision this server speaks.
 *
 * Answered on every `initialize` regardless of what the client asked for, which
 * is what the specification says a server does: it states its own version and
 * the client decides whether it can proceed. Echoing the client's would claim
 * support for a revision nobody here has read.
 */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

export const MCP_SERVER_NAME = "mayarin-rail-intelligence";

/** JSON-RPC's own codes. Nothing here invents one. */
export const JSON_RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

/**
 * `id` is present on a request and absent on a notification, and JSON-RPC
 * allows a string or a number. `null` is a valid id in the specification and is
 * refused here anyway — it is indistinguishable from "absent" once it has been
 * through `JSON.parse`, and this server would answer a notification.
 */
export const mcpRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export type McpRequest = z.infer<typeof mcpRequestSchema>;

export const toolCallParamsSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

/** One tool, as `tools/list` describes it. `inputSchema` is JSON Schema. */
export interface McpTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export type McpId = string | number;

export function jsonRpcResult(id: McpId, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result };
}

export function jsonRpcError(id: McpId, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * A tool's answer.
 *
 * Both forms, always: `content` is what a model reads and `structuredContent` is
 * what a program parses. Serving only the first makes an agent re-parse prose it
 * just received; serving only the second leaves a model with nothing to say.
 */
export function toolResult(
  text: string,
  structuredContent: Record<string, unknown>,
): Record<string, unknown> {
  return { content: [{ type: "text", text }], structuredContent };
}

/**
 * A tool that refused, reported inside a successful JSON-RPC response.
 *
 * The specification is explicit that a tool's own failure is `isError` on the
 * result rather than a JSON-RPC error — a protocol error means the call never
 * reached the tool, and a model that cannot tell those apart cannot decide
 * whether retrying is worth anything.
 */
export function toolError(text: string): Record<string, unknown> {
  return { content: [{ type: "text", text }], isError: true };
}

export function initializeResult(): Record<string, unknown> {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: MCP_SERVER_NAME, version: "1" },
  };
}

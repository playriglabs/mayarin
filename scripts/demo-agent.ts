/**
 * The demo agent (RFC #232): one payer, printing the decisions it makes.
 *
 * bun run scripts/demo-agent.ts --chain arc-testnet --pay-with EURC \
 *   --payer circle --ceiling 1.20
 *
 * What it buys is the **merchant's own** endpoint (`apps/x402-merchant`), not a
 * Mayarin route. A merchant gating an API it wrote itself is the product; a
 * Mayarin endpoint paying a Mayarin endpoint would demonstrate the plumbing.
 *
 * `scripts/e2e-x402.ts` proves a payment — receipt, balances, persisted ledger.
 * This script proves nothing the runner does not already prove; its whole job is
 * to make the reasoning **visible**, because none of it renders on its own. Every
 * number it prints comes off the wire in front of it. There are no fixtures here
 * and there is nothing to seed: a line it cannot support is a line it does not
 * print.
 *
 * Three partners appear as decisions rather than as mentions:
 *
 * - **The Graph** — the agent buys the rail choice from the Subgraph MCP before
 *   it buys anything else. The reason string travels with the choice.
 * - **Uniswap** — the rail the agent can actually pay asks for a different asset
 *   than the merchant is owed, and both sides of that conversion are on screen.
 * - **Arc** — where the payment lands, in the merchant's own settlement asset.
 *
 * ## The two runs that are the point
 *
 * Both come from the deployment's configuration, not from a flag here — a script
 * that refuses its own payment demonstrates nothing about what Mayarin enforces.
 *
 * - **The refusal.** Tighten `QUOTE_DEVIATION_BPS` and the quote is refused
 *   before the payer signs. The refusal is printed with its reason, and the run
 *   exits non-zero without having spent anything.
 * - **The deletion test** (#231's last load-bearing box). Unset
 *   `SUBGRAPH_ENDPOINTS` and the MCP has nothing to sell: it refuses *before*
 *   charging, and the agent says out loud that its rail is now arbitrary.
 *
 * `--dry-run` prints the trace and stops at the first thing that costs money,
 * which is what a rehearsal wants.
 *
 * ## Environment
 *
 * `PAYER_PRIVATE_KEY`, or `CIRCLE_AGENT_WALLET` with `--payer circle`. Nothing
 * else: the price, the rails, the recipient and the EIP-712 domain all arrive in
 * the `402`, and an address typed here is an address that can be wrong.
 */
import {
  CHAIN_IDS,
  type ChainId,
  caip2Of,
  chainLabel,
  chainOfCaip2,
  EVM_CHAIN_IDS,
  transactionExplorerUrl,
} from "@mayarin/chain";
import {
  ASSET_CODES,
  type AssetCode,
  formatMoney,
  fromDecimalString,
  money,
} from "@mayarin/shared";
import {
  decodePaymentRequired,
  decodeSettleResponse,
  domainOf,
  idempotencyKeyOf,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type SettleResponse,
} from "@mayarin/x402";
import type { Address, Hex } from "viem";
import { circleAgentWalletPayer, localKeyPayer, type X402Payer } from "./circle-agent-wallet.ts";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

/** A refusal by Mayarin or by a tool, as opposed to this script being broken. */
class Refused extends Error {}

/**
 * Two servers, and the difference is the demo.
 *
 * `--url` is the **merchant's own** endpoint — `apps/x402-merchant`, an Express
 * app with two dependencies and no key, gating a route it wrote itself. That is
 * what the agent buys, and Mayarin never serves it.
 *
 * `--api` is Mayarin, and the only thing bought there is the rail choice: the
 * Subgraph MCP is Mayarin's own product, so it is the one endpoint in this run
 * that is deliberately not the merchant's.
 */
const base = argument("api") ?? "https://api-testnet.mayarin.xyz";
const resourceUrl = argument("url") ?? "http://localhost:8787/premium";
const mcpUrl = argument("mcp-url") ?? `${base}/x402/mcp`;
const chain = (argument("chain") ?? "arc-testnet") as ChainId;
if (!CHAIN_IDS.includes(chain)) {
  throw new Error(`--chain must be one of ${CHAIN_IDS.join(", ")}, got ${chain}`);
}
/** The asset the agent holds. The merchant's is whatever the merchant's is. */
const payWith = argument("pay-with") ?? "USDC";
/** The rails the agent asks The Graph about. */
const candidates = (argument("chains") ?? "base-sepolia,arc-testnet")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry): entry is ChainId => CHAIN_IDS.includes(entry as ChainId));

const custody = argument("payer") ?? "local-key";
if (custody !== "local-key" && custody !== "circle") {
  throw new Error("--payer must be local-key or circle");
}
const payer: X402Payer =
  custody === "circle"
    ? circleAgentWalletPayer(required("CIRCLE_AGENT_WALLET") as Address, chain)
    : localKeyPayer(required("PAYER_PRIVATE_KEY") as Hex);

/**
 * Rehearsal: print the trace and stop at the first thing that costs money.
 *
 * `PAYER_PRIVATE_KEY` is loaded out of `.env` without being asked for, so a run
 * started to check the framing of a shot is otherwise a run that spends.
 */
const dryRun = process.argv.includes("--dry-run");

/**
 * The most this run will authorise, per purchase, in the asset being signed for.
 *
 * This is the runner's own ceiling and nothing more. It is **not** a spending
 * policy and must not be narrated as one: a script declining to sign is this
 * script's decision, and says nothing about what any wallet provider enforces.
 */
const ceilings: Readonly<Record<"resource" | "rail-intelligence", string>> = {
  resource: argument("ceiling") ?? "0.03",
  "rail-intelligence": argument("mcp-ceiling") ?? "0.15",
};

// ---------------------------------------------------------------------------
// The trace
// ---------------------------------------------------------------------------

function say(line = ""): void {
  console.log(line);
}

function step(line: string): void {
  say(`  → ${line}`);
}

function detail(line: string): void {
  say(`       ${line}`);
}

/** An atomic amount rendered at its own asset's precision, or left as it came. */
function amountOf(requirements: PaymentRequirements): string {
  const name = requirements.extra?.name;
  const asset = ASSET_CODES.find((code) => code === name);
  return asset === undefined
    ? `${requirements.amount} (atomic units of ${requirements.asset})`
    : formatMoney(money(BigInt(requirements.amount), asset));
}

function assetOf(requirements: PaymentRequirements): string | undefined {
  const name = requirements.extra?.name;
  return typeof name === "string" ? name : undefined;
}

/** The first non-empty line, for an error body that may be an HTML page. */
function firstLine(text: string): string {
  const line = text.split("\n").find((entry) => entry.trim() !== "") ?? "";
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

function railLine(requirements: PaymentRequirements): string {
  const network = chainOfCaip2(requirements.network);
  return `${chainLabel(network ?? requirements.network)} · ${amountOf(requirements)}`;
}

// ---------------------------------------------------------------------------
// Paying for things
// ---------------------------------------------------------------------------

interface Purchase {
  readonly body: string;
  readonly settlement: SettleResponse;
  readonly paid: PaymentRequirements;
}

/**
 * Authorizations that were signed and have no confirmed settlement yet.
 *
 * An `exact` authorization cannot be withdrawn, and a `502` from a gateway says
 * nothing about whether the origin broadcast it — the engine persists a
 * broadcast before it confirms one, precisely because that gap exists. So a run
 * that dies after signing has to name what it signed, or the next run is a
 * second payment for the same thing.
 */
const outstanding: {
  what: string;
  rail: string;
  nonce: string;
  idempotencyKey: string;
}[] = [];

function requestInit(headers: Record<string, string>, body: string | undefined): RequestInit {
  const init: RequestInit = {
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    signal: AbortSignal.timeout(120_000),
    redirect: "error",
  };
  return body === undefined ? init : { ...init, method: "POST", body };
}

/** The `402`, decoded, or a refusal that never reached a price. */
async function quote(url: string, body?: string): Promise<PaymentRequired> {
  const unpaid = await fetch(url, requestInit({}, body));
  if (unpaid.status !== 402) {
    throw new Refused(
      `${url} answered HTTP ${unpaid.status} instead of a price: ${await unpaid.text()}`,
    );
  }
  const header = unpaid.headers.get(PAYMENT_REQUIRED_HEADER);
  if (!header) throw new Error(`402 from ${url} carried no ${PAYMENT_REQUIRED_HEADER}`);
  return decodePaymentRequired(header);
}

/**
 * Sign one authorization for exactly what a rail asks, and retry the request.
 *
 * The ceiling is checked before the signature rather than after, because an
 * `exact` authorization cannot be taken back once it is handed over.
 */
async function pay(
  url: string,
  offered: PaymentRequired,
  accepted: PaymentRequirements,
  purpose: keyof typeof ceilings,
  body?: string,
): Promise<Purchase> {
  if (accepted.scheme !== "exact" || accepted.extra?.assetTransferMethod !== "eip3009") {
    throw new Refused(
      `This agent signs EIP-3009 under the exact scheme; the rail offers ${accepted.scheme}/${String(accepted.extra?.assetTransferMethod)}`,
    );
  }
  const network = chainOfCaip2(accepted.network);
  if (network === undefined) throw new Error(`Unknown network ${accepted.network}`);
  const asset = ASSET_CODES.find((code) => code === assetOf(accepted));
  if (asset === undefined) {
    throw new Error(
      `The rail names an asset this agent cannot price: ${String(assetOf(accepted))}`,
    );
  }

  const amount = BigInt(accepted.amount);
  const ceiling = fromDecimalString(ceilings[purpose], asset as AssetCode);
  step(
    `Ceiling for this run: ${formatMoney(ceiling)}. This call: ${amountOf(accepted)} ${amount <= ceiling.amount ? "✓" : "✗"}`,
  );
  if (amount > ceiling.amount) {
    throw new Refused(
      `${amountOf(accepted)} is over this run's own ceiling of ${formatMoney(ceiling)}; nothing was signed`,
    );
  }

  if (dryRun) throw new Refused("--dry-run, so nothing was signed and nothing was spent");

  const validBefore = BigInt(Math.floor(Date.now() / 1000) + accepted.maxTimeoutSeconds - 5);
  const nonce =
    `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}` as Hex;
  const authorization = {
    from: payer.address,
    to: accepted.payTo as Address,
    value: amount,
    validAfter: 0n,
    validBefore,
    nonce,
  };
  step(`Signing one EIP-3009 authorization for exactly ${amountOf(accepted)}…`);
  const signature = await payer.signTransferAuthorization(
    { ...domainOf(accepted, Number(EVM_CHAIN_IDS[network])), verifyingContract: accepted.asset },
    authorization,
  );
  const payment: PaymentPayload = {
    x402Version: 2,
    resource: offered.resource,
    accepted,
    payload: {
      signature,
      authorization: {
        ...authorization,
        value: amount.toString(),
        validAfter: "0",
        validBefore: validBefore.toString(),
      },
    },
  };
  // From here the authorization exists and cannot be taken back. Anything that
  // goes wrong after this line has to be reported as "money may have moved",
  // because a gateway that times out does not mean the origin did nothing.
  outstanding.push({
    what: purpose,
    rail: railLine(accepted),
    nonce,
    idempotencyKey: idempotencyKeyOf(payment),
  });

  const paid = await fetch(
    url,
    requestInit(
      { [PAYMENT_SIGNATURE_HEADER]: Buffer.from(JSON.stringify(payment)).toString("base64") },
      body,
    ),
  );
  const text = await paid.text();
  if (paid.status !== 200) {
    // One line of it. A Cloudflare error page is three hundred lines of markup
    // and the reason, when there is one, is in the first.
    throw new Refused(`the resource answered HTTP ${paid.status}: ${firstLine(text)}`);
  }
  const header = paid.headers.get(PAYMENT_RESPONSE_HEADER);
  if (!header) throw new Error(`A paid 200 from ${url} carried no ${PAYMENT_RESPONSE_HEADER}`);
  const settlement = decodeSettleResponse(header);
  if (!settlement.success) {
    throw new Refused(`settlement failed: ${settlement.errorReason ?? "no reason given"}`);
  }
  outstanding.pop();
  return { body: text, settlement, paid: accepted };
}

/** The settled transaction, and where a judge can go and look at it. */
function reportSettlement(settlement: SettleResponse): void {
  const network = chainOfCaip2(settlement.network) ?? settlement.network;
  const url = transactionExplorerUrl(network, settlement.transaction);
  step(`Settled on ${chainLabel(network)}: ${settlement.transaction}`);
  if (url) detail(url);
}

// ---------------------------------------------------------------------------
// Step 2: buy the rail choice
// ---------------------------------------------------------------------------

interface RailAnswer {
  /** The rail the agent was told to pay on, when it was told anything. */
  readonly chain?: ChainId;
  readonly reason: string;
  /** True when no rail intelligence was available and the choice is arbitrary. */
  readonly arbitrary: boolean;
}

function mcpCall(name: string, args: Record<string, unknown>): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
}

/** The text a tool answered with, plus whatever structure came beside it. */
function toolAnswer(payload: string): {
  readonly text: string;
  readonly structured: Record<string, unknown>;
  readonly isError: boolean;
} {
  const parsed = JSON.parse(payload) as {
    result?: {
      content?: readonly { text?: string }[];
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
    };
    error?: { message?: string };
  };
  if (parsed.error) throw new Refused(`The MCP refused the call: ${parsed.error.message}`);
  const result = parsed.result ?? {};
  return {
    text: result.content?.[0]?.text ?? "",
    structured: result.structuredContent ?? {},
    isError: result.isError === true,
  };
}

/**
 * Ask The Graph which rail has been settling with room to spare.
 *
 * The question costs money, and that is the interesting part: the agent pays to
 * find out where to pay. Three things can come back and all three are printed —
 * an answer, a tool that refused before charging, and an MCP that is not there.
 */
async function chooseRailByPaying(): Promise<RailAnswer> {
  const body = mcpCall("choose_rail", { chains: candidates });
  let offered: PaymentRequired;
  try {
    offered = await quote(mcpUrl, body);
  } catch (error) {
    // A `200` here means the tool refused before the gate — by design, so that
    // an agent is never charged for our own subgraph being unavailable. That is
    // #231's deletion test, and the honest thing to do is say the rail is now
    // arbitrary rather than present the first one as a decision.
    const reason = error instanceof Refused ? error.message : String(error);
    step("The Graph could not be asked, and nothing was charged for the attempt.");
    detail(reason);
    return { reason, arbitrary: true };
  }

  const rail = offered.accepts[0];
  if (rail === undefined) throw new Error("The MCP quoted no rail to pay it on");
  step(`Asking The Graph which rail has headroom. The answer costs ${amountOf(rail)}.`);
  // The one purchase this agent cannot make an informed choice about, because
  // the thing it is buying is the informed choice.
  detail(`Paying for the answer on ${railLine(rail)}, chosen with no advice at all.`);
  const bought = await pay(mcpUrl, offered, rail, "rail-intelligence", body);
  reportSettlement(bought.settlement);

  const answer = toolAnswer(bought.body);
  if (answer.isError) {
    step("The tool answered without a decision, so the rail is arbitrary.");
    detail(answer.text);
    return { reason: answer.text, arbitrary: true };
  }
  const chosen = answer.structured.chain;
  const unobserved = answer.structured.unobserved === true;
  const chain = CHAIN_IDS.find((entry) => entry === chosen);
  say();
  step(`The Graph says: ${answer.text}`);
  if (unobserved) detail("No rail had enough observed settlements to rank. It says so itself.");
  return {
    ...(chain === undefined ? {} : { chain }),
    reason: answer.text,
    arbitrary: unobserved,
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

try {
  say(`Agent: I want ${resourceUrl}`);
  say(`  I hold ${payWith}. I have no account here, and no API key.`);
  say();

  // 1. The price, unpaid.
  const offered = await quote(resourceUrl);
  step(`Asked without paying. HTTP 402, and the terms came back in a header.`);
  detail(`"${offered.resource.description ?? offered.resource.url}"`);
  for (const rail of offered.accepts) detail(railLine(rail));
  say();

  // 2. Which rail, bought rather than guessed.
  const answer = await chooseRailByPaying();
  say();

  // 3. The rail this agent can actually pay, on the chain it was pointed at.
  const preferred = answer.chain ?? chain;
  const wanted = offered.accepts.filter((rail) => assetOf(rail) === payWith);
  const onPreferred = wanted.find((rail) => rail.network === caip2Of(preferred));
  const accepted = onPreferred ?? wanted[0] ?? offered.accepts[0];
  if (accepted === undefined) throw new Error("The resource offered no rail at all");
  if (answer.arbitrary) {
    step(`Paying ${railLine(accepted)} because it was offered first, not because it is better.`);
  } else if (onPreferred === undefined) {
    step(
      `${chainLabel(preferred)} was the better rail, but this resource does not sell ${payWith} there. Paying ${railLine(accepted)}.`,
    );
  } else {
    step(`Paying on ${chainLabel(preferred)}, as advised.`);
  }

  // 4. What the merchant is owed, against what this agent is being asked for.
  const settlement = offered.accepts.find(
    (rail) => rail.network === accepted.network && assetOf(rail) !== payWith,
  );
  if (settlement) {
    say();
    step(`My asset is not the merchant's. The same resource, on the same rail:`);
    detail(`the merchant is priced at ${amountOf(settlement)}`);
    detail(`I am asked for      ${amountOf(accepted)}`);
    detail("Uniswap exact-output: the merchant is paid exactly, and I cover the difference.");
  }

  // 5 and 6. Sign once, and see what the merchant got.
  say();
  const bought = await pay(resourceUrl, offered, accepted, "resource");
  reportSettlement(bought.settlement);
  if (settlement) {
    detail(`The merchant is credited ${amountOf(settlement)} — exactly their price.`);
    detail("Whatever the swap did not need is booked as my change, not absorbed.");
  }
  say();
  say("  This is what I bought:");
  say(`    ${bought.body.slice(0, 600)}`);
  say();
  say("  (no API key was used; this agent has no account with anyone)");
} catch (error) {
  if (!(error instanceof Refused)) throw error;

  say();
  say(`  ✗ Stopped: ${error.message}`);
  if (outstanding.length === 0) {
    say("    Nothing was signed, so nothing can have moved.");
  } else {
    // The dangerous case, and the one a demo script is most likely to hit: the
    // authorization is out there, the nonce may already be spent on-chain, and
    // re-running signs a *second* one. Naming the key is what makes the first
    // one findable instead of merely regrettable.
    say("    An authorization was signed and its outcome is unknown.");
    say("    Money may have moved. Check before running this again:");
    for (const entry of outstanding) {
      say(`      ${entry.what} on ${entry.rail}`);
      say(`        idempotency key  ${entry.idempotencyKey}`);
      say(`        authorization nonce ${entry.nonce}`);
    }
    say(`      payer ${payer.address}`);
  }
  process.exitCode = 1;
}

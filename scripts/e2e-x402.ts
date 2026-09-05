/** A real x402 request, with receipt and persisted-ledger evidence (RFC #207). */
import {
  decodePaymentRequired,
  decodeSettleResponse,
  domainOf,
  idempotencyKeyOf,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  type PaymentPayload,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
} from "@mayarin/x402";
import postgres from "postgres";
import { type Address, createPublicClient, type Hex, http, parseAbi, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const url = argument("url") ?? "https://api-testnet.mayarin.xyz/x402/fx/quote?from=USD&to=USDC";
const payTo = argument("pay-to");
assert(payTo && /^0x[0-9a-f]{40}$/i.test(payTo), "Pass the verified merchant address as --pay-to");
const output = argument("output") ?? "/tmp/mayarin-x402-evidence.json";
const rpcUrls: Record<string, string> = JSON.parse(required("CHAIN_RPC_URLS"));
const rpc = rpcUrls["base-sepolia"];
assert(rpc, "CHAIN_RPC_URLS must contain base-sepolia");
const client = createPublicClient({ transport: http(rpc) });
assert((await client.getChainId()) === 84532, "This test only spends on Base Sepolia");
const payer = privateKeyToAccount(required("PAYER_PRIVATE_KEY") as Hex);
const sql = postgres(required("DATABASE_URL"), { connect_timeout: 10, max: 1 });
const abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function authorizationState(address,bytes32) view returns (bool)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);

try {
  // Fail before signing if the database cannot provide the required evidence.
  await sql`select id from payment_intents limit 0`;
  await sql`select id from ledger_entries limit 0`;
  const unpaid = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "error" });
  assert(unpaid.status === 402, `Expected HTTP 402, received ${unpaid.status}`);
  const header = unpaid.headers.get(PAYMENT_REQUIRED_HEADER);
  assert(header, "402 omitted PAYMENT-REQUIRED");
  const offeredAt = Math.floor(Date.now() / 1000);
  const offered = decodePaymentRequired(header);
  const accepted = offered.accepts.find((rail) => rail.network === "eip155:84532");
  assert(accepted, "The resource does not offer Base Sepolia");
  assert(accepted.scheme === "exact", "Expected the exact scheme");
  assert(accepted.extra?.assetTransferMethod === "eip3009", "Expected EIP-3009");
  const configuredTokens: Record<string, Record<string, string>> = JSON.parse(
    required("CHAIN_ASSETS"),
  );
  assert(
    accepted.asset.toLowerCase() === configuredTokens["base-sepolia"]?.USDC?.toLowerCase(),
    "The resource asks for a token other than configured Base Sepolia USDC",
  );
  assert(accepted.payTo.toLowerCase() === payTo.toLowerCase(), "Unexpected payment recipient");
  const amount = BigInt(accepted.amount);
  assert(amount > 0n && amount <= 20_000n, "Test payment must be at most 0.02 USDC");
  assert(
    Number.isSafeInteger(accepted.maxTimeoutSeconds) && accepted.maxTimeoutSeconds > 10,
    "The authorization window is too short",
  );
  const token = accepted.asset as Address;
  const recipient = accepted.payTo as Address;
  const balanceOf = (address: Address) =>
    client.readContract({
      address: token,
      abi,
      functionName: "balanceOf",
      args: [address],
    });
  const [payerBefore, merchantBefore] = await Promise.all([
    balanceOf(payer.address),
    balanceOf(recipient),
  ]);
  assert(payerBefore >= amount, "Payer has insufficient test USDC");
  assert(
    payer.address.toLowerCase() !== recipient.toLowerCase(),
    "Payer must differ from recipient",
  );
  console.log(
    JSON.stringify({
      phase: "preflight",
      network: accepted.network,
      payer: payer.address,
      recipient,
      amount: amount.toString(),
      payerBalance: payerBefore.toString(),
      merchantBalance: merchantBefore.toString(),
    }),
  );
  if (!process.argv.includes("--check")) {
    const nonce =
      `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}` as Hex;
    const validBefore = BigInt(offeredAt + accepted.maxTimeoutSeconds - 5);
    assert(
      validBefore > BigInt(Math.floor(Date.now() / 1000) + 5),
      "Quote expired during preflight",
    );
    const message = {
      from: payer.address,
      to: recipient,
      value: amount,
      validAfter: 0n,
      validBefore,
      nonce,
    };
    const domain = domainOf(accepted, 84532);
    const signature = await payer.signTypedData({
      domain: { ...domain, verifyingContract: token },
      types: TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message,
    });
    const payment: PaymentPayload = {
      x402Version: 2,
      resource: offered.resource,
      accepted,
      payload: {
        signature,
        authorization: {
          ...message,
          value: amount.toString(),
          validAfter: "0",
          validBefore: validBefore.toString(),
        },
      },
    };
    const idempotencyKey = idempotencyKeyOf(payment);
    const evidence: Record<string, unknown> = {
      url,
      network: accepted.network,
      payer: payer.address,
      recipient,
      token,
      amount: amount.toString(),
      nonce,
      idempotencyKey,
      startedAt: new Date().toISOString(),
    };
    const save = () => Bun.write(output, `${JSON.stringify(evidence, null, 2)}\n`);
    // Keep the nonce even if the connection drops after the server broadcasts.
    await save();
    console.log("Signing one authorization and retrying the resource without an API key.");
    const paid = await fetch(url, {
      headers: {
        [PAYMENT_SIGNATURE_HEADER]: Buffer.from(JSON.stringify(payment)).toString("base64"),
      },
      signal: AbortSignal.timeout(120_000),
      redirect: "error",
    });
    evidence.httpStatus = paid.status;
    evidence.body = await paid.text();
    const responseHeader = paid.headers.get(PAYMENT_RESPONSE_HEADER);
    const settlement = responseHeader ? decodeSettleResponse(responseHeader) : undefined;
    evidence.settlement = settlement;
    await save();
    console.log(
      JSON.stringify({ phase: "response", status: paid.status, settlement, body: evidence.body }),
    );

    const intents = await sql`
      select id,status,payment_chain,execution_path,clearing_transaction_id,failure_reason
      from payment_intents where idempotency_key=${idempotencyKey}`;
    evidence.intents = intents;
    const intent = intents[0];
    if (intent?.clearing_transaction_id) {
      const clearingId = String(intent.clearing_transaction_id);
      evidence.clearing = await sql`
        select id,state,settlement_amount,settlement_asset,fee_amount,net_amount,provider_reference,
          on_chain_settled_amount,on_chain_fee,on_chain_refund_amount
        from clearing_transactions where id=${clearingId}`;
      evidence.entries = await sql`
        select t.id as posting_id,t.idempotency_key,e.account_code,e.direction,e.amount,e.asset
        from ledger_transactions t join ledger_entries e on e.transaction_id=t.id
        where t.reference=${clearingId} order by t.created_at,e.id`;
      evidence.postingTotals = await sql`
        select t.id,t.idempotency_key,e.asset,count(*)::int as entries,
          sum(case when e.direction='DEBIT' then e.amount else 0 end)::text as debits,
          sum(case when e.direction='CREDIT' then e.amount else 0 end)::text as credits
        from ledger_transactions t join ledger_entries e on e.transaction_id=t.id
        where t.reference=${clearingId} group by t.id,e.asset order by t.id`;
    }
    const [payerAfter, merchantAfter, used] = await Promise.all([
      balanceOf(payer.address),
      balanceOf(recipient),
      client.readContract({
        address: token,
        abi,
        functionName: "authorizationState",
        args: [payer.address, nonce],
      }),
    ]);
    evidence.balances = {
      payerBefore: payerBefore.toString(),
      payerAfter: payerAfter.toString(),
      merchantBefore: merchantBefore.toString(),
      merchantAfter: merchantAfter.toString(),
    };
    evidence.authorizationUsed = used;
    await save();
    assert(settlement?.success, "PAYMENT-RESPONSE did not confirm success");
    assert(settlement.network === accepted.network, "Settlement reported the wrong chain");
    const receipt = await client.getTransactionReceipt({ hash: settlement.transaction as Hex });
    const transfers = parseEventLogs({ abi, eventName: "Transfer", logs: receipt.logs }).filter(
      (log) => log.address.toLowerCase() === token.toLowerCase(),
    );
    const delivered = transfers
      .filter(
        (log) =>
          log.args.from.toLowerCase() === payer.address.toLowerCase() &&
          log.args.to.toLowerCase() === recipient.toLowerCase(),
      )
      .reduce((sum, log) => sum + log.args.value, 0n);
    evidence.receipt = {
      hash: receipt.transactionHash,
      status: receipt.status,
      blockNumber: receipt.blockNumber.toString(),
      delivered: delivered.toString(),
      gasCostWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    };
    await save();
    assert(paid.status === 200, `Paid resource failed: HTTP ${paid.status}; evidence at ${output}`);
    assert(
      receipt.status === "success" && delivered === amount,
      "Receipt does not prove the exact transfer",
    );
    assert(
      used && payerBefore - payerAfter === amount && merchantAfter - merchantBefore === amount,
      "On-chain balances or authorization state disagree with the payment",
    );
    assert(
      intents.length === 1 &&
        intent?.status === "COMPLETED" &&
        intent.payment_chain === "base-sepolia",
      "Expected one completed Base Sepolia intent",
    );
    const totals = evidence.postingTotals as
      | readonly { debits: string; credits: string }[]
      | undefined;
    assert(totals && totals.length >= 3, "Missing expected clearing postings");
    assert(
      totals.every((row) => BigInt(row.debits) > 0n && row.debits === row.credits),
      "Ledger postings are not balanced per asset",
    );
    const [booked] = evidence.clearing as readonly {
      state: string;
      fee_amount: string;
      net_amount: string;
      provider_reference: string;
      on_chain_settled_amount: string;
      on_chain_fee: string;
    }[];
    assert(
      booked?.state === "SUCCESS" && booked.fee_amount === "0" && booked.on_chain_fee === "0",
      "Direct x402 payment booked a fee that was not collected",
    );
    assert(
      booked.net_amount === amount.toString() &&
        booked.on_chain_settled_amount === amount.toString(),
      "Ledger net settlement differs from the merchant's actual transfer",
    );
    assert(
      booked.provider_reference === receipt.transactionHash,
      "Clearing lost the confirmed transaction hash",
    );
    const entries = evidence.entries as readonly {
      account_code: string;
      direction: string;
      amount: string;
    }[];
    assert(
      !entries.some(
        (entry) =>
          entry.account_code.startsWith("FEE_REVENUE:") ||
          entry.account_code.startsWith("MERCHANT_HOLDING:"),
      ),
      "Direct payout created uncollected revenue or an internal merchant holding",
    );
    const treasury = entries
      .filter((entry) => entry.account_code === "TREASURY:USDC")
      .reduce(
        (sum, entry) =>
          sum + (entry.direction === "DEBIT" ? BigInt(entry.amount) : -BigInt(entry.amount)),
        0n,
      );
    assert(treasury === 0n, "Direct payout left a phantom treasury balance");
    evidence.verified = true;
    await save();
    console.log(
      `PASS: exact on-chain transfer, completed intent, balanced postings. Evidence: ${output}`,
    );
  }
} finally {
  await sql.end();
}

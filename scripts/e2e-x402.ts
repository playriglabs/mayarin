/**
 * A real x402 request, with receipt and persisted-ledger evidence (RFC #207).
 *
 * bun run scripts/e2e-x402.ts --pay-to 0x… [--chain arc-testnet] [--url …] [--check]
 *
 * `--chain` names the rail the resource must offer; the run refuses a header
 * that does not advertise it. `--check` stops after the preflight, before an
 * authorization is signed and before anything is spent.
 *
 * **Cross-asset** (#211), where the agent holds one asset and the merchant is
 * paid another:
 *
 * bun run scripts/e2e-x402.ts --pay-with EURC
 *
 * No addresses: the rail advertises the **operator**, which is derived from
 * `OPERATOR_PRIVATE_KEY`, and where the merchant is paid is read out of the
 * database the way the signer reads it — their configured address first, then
 * their verified managed wallet on this chain. `--pay-to` and `--merchant`
 * override either, for a run against a deployment whose keys are not local.
 *
 * The payer's asset has to land somewhere Mayarin can swap it from, and
 * `transferWithAuthorization` names one recipient chosen before the payer
 * signs — which is why the operator is the recipient rather than the merchant.
 * The run then checks three balances rather than two: the payer loses exactly
 * what they authorised, the merchant gains exactly the invoice, and the
 * operator keeps the difference as the payer's booked surplus.
 *
 * **`PAYER_PRIVATE_KEY` and `OPERATOR_PRIVATE_KEY` must be different keys.**
 * The claim being tested is that Mayarin never holds the payer's, and one key
 * playing both parts tests nothing — a self-transfer moves no money and the
 * balance arithmetic has nothing to say.
 *
 * ## Running it against a local API
 *
 * No deployment is involved. The chain is remote and the API is not, which is
 * how #207's fixes were verified before anything was released.
 *
 * 1. `bun run db:up` and migrate, then `bun run dev` with `X402_ENABLED=true`,
 *    a funded `OPERATOR_PRIVATE_KEY`, and `QUOTE_ENABLED=true` naming a venue
 *    with a pool on the chain — Base Sepolia's EURC/USDC is in `UNISWAP_POOLS`.
 * 2. The merchant needs a settlement address on that chain, because a
 *    cross-asset swap delivers to the merchant rather than to the rail's
 *    `payTo`. Set one, or provision a managed wallet.
 * 3. `market_config.stablecoins` is seeded once and never overwritten (#95), so
 *    a payer asset the merchant will accept has to reach the admin API — the
 *    environment and the runtime registry are two sources of truth and both
 *    have to agree.
 * 4. Register the resource with a cross-asset accept:
 *    `POST /admin/x402/resources` naming the payer's token and the **operator**
 *    as `payTo`. Registration refuses any other recipient.
 * 5. Fund `PAYER_PRIVATE_KEY` with the payer's asset. The payer pays no gas
 *    here: the operator broadcasts the authorization and then the swap.
 */
import { CHAIN_IDS, type ChainId, caip2Of, EVM_CHAIN_IDS } from "@mayarin/chain";
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
const chain = (argument("chain") ?? "base-sepolia") as ChainId;
assert(CHAIN_IDS.includes(chain), `--chain must be one of ${CHAIN_IDS.join(", ")}, got ${chain}`);
const chainId = Number(EVM_CHAIN_IDS[chain]);
const network = caip2Of(chain);
// Arc's own currency is USDC: its native view (18 decimals) and its ERC-20 view
// (6) are one balance, so the payment and the gas come out of the same number.
const nativeMirrorsAsset: readonly ChainId[] = ["arc-testnet"];
const mirrored = nativeMirrorsAsset.includes(chain);
const settlesIn = argument("settles-in") ?? process.env.SETTLEMENT_ASSET ?? "USDC";
const payWith = argument("pay-with") ?? settlesIn;
const crossAsset = payWith !== settlesIn;
// A cross-asset rail advertises the operator, and the operator is whoever holds
// the key this deployment signs with — so it is derived rather than typed. An
// address wrong there sends the payer's asset somewhere nothing can swap it
// from, and an authorization cannot be taken back.
const payTo =
  argument("pay-to") ??
  (crossAsset ? privateKeyToAccount(required("OPERATOR_PRIVATE_KEY") as Hex).address : undefined);
assert(
  payTo && /^0x[0-9a-f]{40}$/i.test(payTo),
  "Pass the address the rail advertises as --pay-to — the merchant on a same-asset rail, derived from OPERATOR_PRIVATE_KEY on a cross-asset one",
);
/** Overrides the address the deployment would pay this merchant at, if given. */
const merchantOverride = argument("merchant");
const output = argument("output") ?? "/tmp/mayarin-x402-evidence.json";
const rpcUrls: Record<string, string> = JSON.parse(required("CHAIN_RPC_URLS"));
const rpc = rpcUrls[chain];
assert(rpc, `CHAIN_RPC_URLS must contain ${chain}`);
const client = createPublicClient({ transport: http(rpc) });
assert((await client.getChainId()) === chainId, "RPC does not match the selected testnet");
const payer = privateKeyToAccount(required("PAYER_PRIVATE_KEY") as Hex);
const sql = postgres(required("DATABASE_URL"), { connect_timeout: 10, max: 1 });
const abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
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
  const accepted = offered.accepts.find((rail) => rail.network === network);
  assert(accepted, `The resource does not offer ${chain}`);
  assert(accepted.scheme === "exact", "Expected the exact scheme");
  assert(accepted.extra?.assetTransferMethod === "eip3009", "Expected EIP-3009");
  const configuredTokens: Record<string, Record<string, string>> = JSON.parse(
    required("CHAIN_ASSETS"),
  );
  assert(
    accepted.asset.toLowerCase() === configuredTokens[chain]?.[payWith]?.toLowerCase(),
    `The resource asks for a token other than configured testnet ${payWith}`,
  );
  const settlementToken = configuredTokens[chain]?.[settlesIn];
  assert(settlementToken, `CHAIN_ASSETS has no ${settlesIn} on ${chain}`);
  assert(accepted.payTo.toLowerCase() === payTo.toLowerCase(), "Unexpected payment recipient");
  const amount = BigInt(accepted.amount);
  // A cross-asset authorization is the invoice grossed up by slippage, so the
  // ceiling is a little above the same-asset one and still small enough that a
  // mistake costs cents.
  assert(
    amount > 0n && amount <= (crossAsset ? 30_000n : 20_000n),
    `Test payment must be at most ${crossAsset ? "0.03" : "0.02"} ${payWith}`,
  );
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
  const settlementBalanceOf = (address: Address) =>
    client.readContract({
      address: settlementToken as Address,
      abi,
      functionName: "balanceOf",
      args: [address],
    });
  // Where this deployment would pay the merchant, read the way the signer reads
  // it: the merchant's configured address first, then their verified managed
  // wallet on this chain. Looked up rather than passed, because a run checking
  // a balance at an address the code would never pay proves nothing.
  const resolved = crossAsset
    ? await sql`
        select coalesce(m.settlement_address, w.address) as address
        from x402_resources r
        join merchants m on m.id = r.merchant_id
        left join merchant_wallets w
          on w.merchant_id = m.id and w.chain = ${chain}
          and w.provenance = 'managed' and w.verified_at is not null
        where r.url = ${offered.resource.url}
        limit 1`
    : [];
  const merchantAddress = merchantOverride ?? (resolved[0]?.address as string | undefined) ?? payTo;
  assert(
    !crossAsset || /^0x[0-9a-f]{40}$/i.test(merchantAddress),
    `The merchant behind ${offered.resource.url} has no settlement address on ${chain}; set one, provision a wallet, or pass --merchant`,
  );
  assert(
    !crossAsset || merchantAddress.toLowerCase() !== payTo.toLowerCase(),
    "A cross-asset rail pays the operator, so the merchant's address must differ from it",
  );
  assert(
    !crossAsset || merchantAddress.toLowerCase() !== payer.address.toLowerCase(),
    "The payer cannot also be the merchant: nothing would move",
  );
  const merchant = merchantAddress as Address;
  // Three balances on a cross-asset run, not two. `recipient` is the operator
  // there — what it keeps is the payer's change, and checking only the payer
  // and the merchant would let an unbooked balance sit at the operator unseen.
  const [payerBefore, merchantBefore, operatorBefore] = await Promise.all([
    balanceOf(payer.address),
    crossAsset ? settlementBalanceOf(merchant) : balanceOf(recipient),
    crossAsset ? balanceOf(recipient) : Promise.resolve(0n),
  ]);
  // Capture the native view too, at native precision, so gas paid by a payer who
  // also broadcasts is reconciled rather than mistaken for a short payment. The
  // factor comes off the token, because that is the half of the pair that moves.
  const nativeScale = mirrored
    ? 10n **
      (18n - BigInt(await client.readContract({ address: token, abi, functionName: "decimals" })))
    : undefined;
  const nativeBefore = mirrored
    ? await Promise.all([
        client.getBalance({ address: payer.address }),
        client.getBalance({ address: recipient }),
      ])
    : undefined;
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
      ...(crossAsset
        ? {
            payWith,
            settlesIn,
            merchant,
            operatorBalance: operatorBefore.toString(),
          }
        : {}),
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
    const domain = domainOf(accepted, chainId);
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
    const [payerAfter, merchantAfter, operatorAfter, used] = await Promise.all([
      balanceOf(payer.address),
      crossAsset ? settlementBalanceOf(merchant) : balanceOf(recipient),
      crossAsset ? balanceOf(recipient) : Promise.resolve(0n),
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
      ...(crossAsset
        ? {
            operatorBefore: operatorBefore.toString(),
            operatorAfter: operatorAfter.toString(),
          }
        : {}),
    };
    if (intent?.clearing_transaction_id) {
      // Both chain movements, from the log rather than inferred. The reference
      // on the row is the swap; the authorization is the event before it, and
      // a cross-asset payment that lost one of them is unrecoverable.
      evidence.settlementEvents = await sql`
        select type,payload from clearing_events
        where clearing_transaction_id=${String(intent.clearing_transaction_id)}
          and type in ('settlement.broadcast','settlement.swap')
        order by sequence`;
    }
    evidence.authorizationUsed = used;
    await save();
    assert(settlement?.success, "PAYMENT-RESPONSE did not confirm success");
    assert(settlement.network === accepted.network, "Settlement reported the wrong chain");

    // `PAYMENT-RESPONSE` names the transaction the payer's signature produced,
    // and on a cross-asset rail that is the authorization rather than the swap —
    // coherently, since its `amount` is in the asset the payer paid. The
    // transaction that pays the merchant is the swap, and the log is where the
    // two are told apart.
    const referenceOf = (type: string) =>
      (
        (evidence.settlementEvents ?? []) as readonly {
          type: string;
          payload: { providerReference?: string };
        }[]
      ).find((event) => event.type === type)?.payload?.providerReference;
    const authorizationHash = referenceOf("settlement.broadcast") ?? settlement.transaction;
    const swapHash = referenceOf("settlement.swap");
    assert(
      !crossAsset || swapHash !== undefined,
      "A cross-asset payment recorded no settlement.swap event; nothing names the transaction that paid the merchant",
    );
    assert(
      !crossAsset || authorizationHash === settlement.transaction,
      "PAYMENT-RESPONSE names a transaction the log does not record as the authorization",
    );
    evidence.transactions = { authorization: authorizationHash, swap: swapHash };

    // Both movements are read on a cross-asset run: the authorization is what
    // charged the payer, and the swap is what paid the merchant. Checking one
    // proves half a payment.
    const receipt = await client.getTransactionReceipt({
      hash: (crossAsset ? (swapHash as string) : settlement.transaction) as Hex,
    });
    const authorizationReceipt = crossAsset
      ? await client.getTransactionReceipt({ hash: authorizationHash as Hex })
      : receipt;
    const gasCost = receipt.gasUsed * receipt.effectiveGasPrice;
    const nativeAfter =
      nativeBefore === undefined
        ? undefined
        : await Promise.all([
            client.getBalance({ address: payer.address }),
            client.getBalance({ address: recipient }),
          ]);
    const broadcaster = receipt.from.toLowerCase();
    const gasPaidByPayer = broadcaster === payer.address.toLowerCase() ? gasCost : 0n;
    const gasPaidByMerchant = broadcaster === recipient.toLowerCase() ? gasCost : 0n;
    if (nativeBefore !== undefined && nativeAfter !== undefined && nativeScale !== undefined) {
      evidence.nativeBalances = {
        scale: nativeScale.toString(),
        broadcaster,
        payerBefore: nativeBefore[0].toString(),
        payerAfter: nativeAfter[0].toString(),
        merchantBefore: nativeBefore[1].toString(),
        merchantAfter: nativeAfter[1].toString(),
        gasPaidByPayer: gasPaidByPayer.toString(),
        gasPaidByMerchant: gasPaidByMerchant.toString(),
      };
    }
    const logs = parseEventLogs({ abi, eventName: "Transfer", logs: receipt.logs });
    const authorizationLogs = crossAsset
      ? parseEventLogs({ abi, eventName: "Transfer", logs: authorizationReceipt.logs })
      : logs;
    // Filtered by the emitting contract, always. On Arc one USDC movement writes
    // a `Transfer` on the native view as well as on the ERC-20 one, so a sum
    // over every log is right on Base and double on Arc.
    const movedIn = (
      source: typeof logs,
      contract: string,
      from: string | undefined,
      to: string | undefined,
    ) =>
      source
        .filter(
          (log) =>
            log.address.toLowerCase() === contract.toLowerCase() &&
            (from === undefined || log.args.from.toLowerCase() === from.toLowerCase()) &&
            (to === undefined || log.args.to.toLowerCase() === to.toLowerCase()),
        )
        .reduce((sum, log) => sum + log.args.value, 0n);
    const movedBy = (contract: string, from: string | undefined, to: string | undefined) =>
      movedIn(logs, contract, from, to);

    // Same-asset: the authorization *is* the settlement, payer to merchant.
    // Cross-asset: the swap is what pays the merchant, so the proof is the
    // settlement token arriving at their address — and separately the payer's
    // asset reaching the operator, which is the half the authorization did.
    const delivered = crossAsset
      ? movedBy(settlementToken, undefined, merchant)
      : movedBy(token, payer.address, recipient);
    const spent = crossAsset ? movedBy(token, recipient, undefined) : 0n;
    const authorised = crossAsset
      ? movedIn(authorizationLogs, token, payer.address, recipient)
      : 0n;
    evidence.receipt = {
      hash: receipt.transactionHash,
      status: receipt.status,
      blockNumber: receipt.blockNumber.toString(),
      delivered: delivered.toString(),
      ...(crossAsset
        ? {
            spent: spent.toString(),
            authorization: authorizationReceipt.transactionHash,
            authorised: authorised.toString(),
          }
        : {}),
      gasCostWei: gasCost.toString(),
    };
    await save();
    assert(paid.status === 200, `Paid resource failed: HTTP ${paid.status}; evidence at ${output}`);
    const [invoiceRow] = (evidence.clearing ?? []) as readonly { settlement_amount: string }[];
    // What the merchant was owed, from the lock rather than from the header —
    // the header carries what moved, and the point is whether it matches.
    const invoice = crossAsset ? BigInt(invoiceRow?.settlement_amount ?? "0") : amount;
    assert(
      receipt.status === "success" && delivered === invoice,
      `The settlement receipt does not prove the merchant was paid: ${delivered} delivered against an invoice of ${invoice}`,
    );
    assert(
      !crossAsset || (authorizationReceipt.status === "success" && authorised === amount),
      `The authorization receipt does not prove the payer was charged: ${authorised} moved against an authorization of ${amount}`,
    );
    assert(used, "Authorization was not consumed");
    if (nativeBefore !== undefined && nativeAfter !== undefined && nativeScale !== undefined) {
      // The payment is exact at native precision, and every unit the payer lost
      // beyond it is gas it paid by broadcasting its own authorization.
      assert(
        nativeBefore[0] - nativeAfter[0] === amount * nativeScale + gasPaidByPayer &&
          nativeAfter[1] - nativeBefore[1] === amount * nativeScale - gasPaidByMerchant,
        "Native balances disagree with the payment and the gas it cost",
      );
      // One balance behind two views: the ERC-20 view is the native one scaled,
      // so an accounting that reads either number reads the same money.
      assert(
        payerBefore === nativeBefore[0] / nativeScale &&
          payerAfter === nativeAfter[0] / nativeScale &&
          merchantBefore === nativeBefore[1] / nativeScale &&
          merchantAfter === nativeAfter[1] / nativeScale,
        "The ERC-20 view is not the native view scaled — two balances, not one",
      );
    } else if (crossAsset) {
      // Three statements, and the third is the one this rail exists to keep
      // honest: the payer is charged exactly what they signed for, the merchant
      // receives exactly their invoice, and every unit the swap did not consume
      // is still at the operator rather than quietly gone.
      assert(payerBefore - payerAfter === amount, "The payer was not charged what they authorised");
      assert(
        merchantAfter - merchantBefore === invoice,
        "The merchant did not receive their invoice exactly",
      );
      assert(
        operatorAfter - operatorBefore === amount - spent,
        "The operator's balance disagrees with what the swap consumed",
      );
      const surplus = (evidence.entries as readonly { account_code: string; amount: string }[])
        .filter((entry) => entry.account_code === `PAYER_SURPLUS:${payWith}`)
        .reduce((sum, entry) => sum + BigInt(entry.amount), 0n);
      assert(
        surplus === amount - spent,
        `The payer's change is at the operator but not on the books: ${surplus} booked, ${amount - spent} held`,
      );
    } else {
      assert(
        payerBefore - payerAfter === amount && merchantAfter - merchantBefore === amount,
        "On-chain balances disagree with the payment",
      );
    }
    assert(
      intents.length === 1 && intent?.status === "COMPLETED" && intent.payment_chain === chain,
      "Expected one completed intent on the selected testnet",
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

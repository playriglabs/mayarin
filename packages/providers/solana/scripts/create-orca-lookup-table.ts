import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  AddressLookupTableProgram,
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ORCA_DEVNET_PYUSD_MINT,
  ORCA_DEVNET_USDC_MINT,
  ORCA_DEVNET_USDC_PYUSD_WHIRLPOOL,
  OrcaSolanaRouteSource,
} from "../src/orca.ts";
import {
  paymentRouterAddresses,
  paymentRouterRouteAddress,
  SOLANA_WRAPPED_NATIVE_MINT,
} from "../src/payment.ts";

const PROGRAM_ID = "5raasGCxqaEvGsvQ1PvGxRB1JYnA7Y3L4LfjRCfkNJ4f";
const USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const SOL_USDC_WHIRLPOOL = "5GPCnpWwoDayCP5FVCJT1cS7dePufC5FrjPTVvPoUYnm";
const SURROGATE_USDG_MINT = "H1hMJToegAs8mXt23eVuwKJb17fz4N5emZBCzAvmBF6R";
const SURROGATE_USDG_WHIRLPOOL = "LkKtkAzT4kjfwv6objWTRXo4pLpBUmdEJyJ9Uy2zHsM";
const SURROGATE_USDT_MINT = "8PtqaCwyS3JT1JfJgkKsFnYRkftQLpRc2kvxebxMUuus";
const SURROGATE_USDT_WHIRLPOOL = "6L9dVPZZbvm4jGxPCgrKfiGsnJaQTS5562UEGcRVZyow";

function rpcUrl(): string {
  const urls = JSON.parse(process.env.CHAIN_RPC_URLS ?? "{}") as Record<string, string>;
  const value = urls["solana-devnet"] ?? process.env.SOLANA_RPC_URL;
  if (value === undefined || value.length === 0) throw new Error("Solana devnet RPC is missing");
  return value;
}

async function loadAdmin(): Promise<Keypair> {
  const path =
    process.env.SOLANA_DEVNET_DEPLOYER_KEYPAIR ??
    new URL("../../../../.keys/solana-devnet-deployer.json", import.meta.url);
  return Keypair.fromSecretKey(Uint8Array.from((await Bun.file(path).json()) as number[]));
}

async function waitForSignature(connection: Connection, signature: string): Promise<void> {
  for (let attempt = 0; attempt < 75; attempt += 1) {
    const status = (await connection.getSignatureStatuses([signature])).value[0];
    if (status?.err !== null && status?.err !== undefined) {
      throw new Error(`Transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return;
    }
    await Bun.sleep(1_000);
  }
  throw new Error(`Timed out confirming ${signature}`);
}

async function send(
  connection: Connection,
  payer: Keypair,
  transaction: Transaction,
): Promise<string> {
  transaction.feePayer = payer.publicKey;
  transaction.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  transaction.sign(payer);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    preflightCommitment: "confirmed",
  });
  await waitForSignature(connection, signature);
  return signature;
}

async function main(): Promise<void> {
  const connection = new Connection(rpcUrl(), "confirmed");
  const admin = await loadAdmin();
  const source = new OrcaSolanaRouteSource({
    pools: [
      {
        address: SOL_USDC_WHIRLPOOL,
        tokenMintA: SOLANA_WRAPPED_NATIVE_MINT,
        tokenMintB: USDC_MINT,
      },
      {
        address: ORCA_DEVNET_USDC_PYUSD_WHIRLPOOL,
        tokenMintA: ORCA_DEVNET_USDC_MINT,
        tokenMintB: ORCA_DEVNET_PYUSD_MINT,
      },
      {
        address: SURROGATE_USDG_WHIRLPOOL,
        tokenMintA: USDC_MINT,
        tokenMintB: SURROGATE_USDG_MINT,
      },
      {
        address: SURROGATE_USDT_WHIRLPOOL,
        tokenMintA: USDC_MINT,
        tokenMintB: SURROGATE_USDT_MINT,
      },
    ],
  });
  const routeRequests = [
    {
      inputMint: SOLANA_WRAPPED_NATIVE_MINT,
      settlementMint: USDC_MINT,
      inputAmount: 10_000_000n,
    },
    {
      inputMint: ORCA_DEVNET_PYUSD_MINT,
      settlementMint: ORCA_DEVNET_USDC_MINT,
      inputAmount: 1_000_000n,
    },
    {
      inputMint: SURROGATE_USDG_MINT,
      settlementMint: USDC_MINT,
      inputAmount: 10_000n,
    },
    {
      inputMint: SURROGATE_USDT_MINT,
      settlementMint: USDC_MINT,
      inputAmount: 10_000n,
    },
  ] as const;
  const routes = await Promise.all(
    routeRequests.map((request) =>
      source.route({
        connection,
        paymentRouter: PROGRAM_ID,
        ...request,
        minOut: 1n,
      }),
    ),
  );
  const configuredTables = (
    JSON.parse(process.env.SOLANA_ORCA_LOOKUP_TABLES ?? "{}") as Record<string, string[]>
  )["solana-devnet"];
  const configuredTable = configuredTables?.[0];
  const created =
    configuredTable === undefined
      ? AddressLookupTableProgram.createLookupTable({
          authority: admin.publicKey,
          payer: admin.publicKey,
          recentSlot: await connection.getSlot("finalized"),
        })
      : null;
  const lookupTable = configuredTable === undefined ? created?.[1] : new PublicKey(configuredTable);
  if (lookupTable === undefined) throw new Error("Failed to resolve Orca lookup table");
  const createSignature =
    created === null ? null : await send(connection, admin, new Transaction().add(created[0]));
  const addresses = [
    new PublicKey(PROGRAM_ID),
    SYSVAR_INSTRUCTIONS_PUBKEY,
    SystemProgram.programId,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    ...routes.flatMap((route, index) => {
      const request = routeRequests[index];
      if (request === undefined) throw new Error("Orca route request is missing");
      const inputAddresses = paymentRouterAddresses(PROGRAM_ID, request.inputMint);
      const settlementAddresses = paymentRouterAddresses(PROGRAM_ID, request.settlementMint);
      return [
        new PublicKey(route.route.programId),
        inputAddresses.config,
        inputAddresses.routerAuthority,
        inputAddresses.inputAsset,
        settlementAddresses.settlementAsset,
        paymentRouterRouteAddress(PROGRAM_ID, route.route.programId),
        ...route.route.accounts.map((account) => account.pubkey),
      ];
    }),
  ].filter(
    (address, index, all) => all.findIndex((candidate) => candidate.equals(address)) === index,
  );
  const current = await connection.getAddressLookupTable(lookupTable);
  const missing = addresses.filter(
    (address) =>
      current.value?.state.addresses.some((existing) => existing.equals(address)) !== true,
  );
  const extendSignatures: string[] = [];
  for (let offset = 0; offset < missing.length; offset += 20) {
    extendSignatures.push(
      await send(
        connection,
        admin,
        new Transaction().add(
          AddressLookupTableProgram.extendLookupTable({
            authority: admin.publicKey,
            payer: admin.publicKey,
            lookupTable,
            addresses: missing.slice(offset, offset + 20),
          }),
        ),
      ),
    );
  }
  console.log(
    JSON.stringify({
      ok: true,
      lookupTable: lookupTable.toBase58(),
      addresses: addresses.length,
      addedAddresses: missing.length,
      createSignature,
      extendSignatures,
    }),
  );
}

await main();

import {
  Connection,
  Keypair,
  type PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { ORCA_DEVNET_PYUSD_MINT, ORCA_DEVNET_USDC_MINT } from "../src/orca.ts";
import {
  addInputAssetInstruction,
  addSettlementAssetInstruction,
  addSwapRouterInstruction,
  paymentRouterAddresses,
  paymentRouterRouteAddress,
  removeInputAssetInstruction,
  removeSettlementAssetInstruction,
  SOLANA_WRAPPED_NATIVE_MINT,
} from "../src/payment.ts";

const PROGRAM_ID = "5raasGCxqaEvGsvQ1PvGxRB1JYnA7Y3L4LfjRCfkNJ4f";
const USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const USDG_MINT = "4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7";
const SURROGATE_USDG_MINT = "H1hMJToegAs8mXt23eVuwKJb17fz4N5emZBCzAvmBF6R";
const SURROGATE_USDT_MINT = "8PtqaCwyS3JT1JfJgkKsFnYRkftQLpRc2kvxebxMUuus";
const ORCA_WHIRLPOOL_PROGRAM = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
const OBSOLETE_TEST_MINTS = [
  "EfDfid7NS7vNSk1UQpcbS7PKNDETMcd9Lizf5QocySKB",
  "5wZeroUpMe9ZToFp9gR8Jd59GJCmEPuGdZca6XsbtGLg",
] as const;

function devnetRpcUrl(): string {
  const urls = JSON.parse(process.env.CHAIN_RPC_URLS ?? "{}") as Record<string, string>;
  const url = urls["solana-devnet"] ?? process.env.SOLANA_RPC_URL;
  if (url === undefined || url.length === 0) {
    throw new Error("CHAIN_RPC_URLS must contain solana-devnet (or set SOLANA_RPC_URL)");
  }
  return url;
}

async function loadAdmin(): Promise<Keypair> {
  const configured = process.env.SOLANA_DEVNET_DEPLOYER_KEYPAIR;
  const path =
    configured ?? new URL("../../../../.keys/solana-devnet-deployer.json", import.meta.url);
  const bytes = (await Bun.file(path).json()) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

async function maybeRemove(
  connection: Connection,
  admin: PublicKey,
  mint: string,
): Promise<readonly TransactionInstruction[]> {
  const addresses = paymentRouterAddresses(PROGRAM_ID, mint);
  const accounts = await connection.getMultipleAccountsInfo([
    addresses.inputAsset,
    addresses.settlementAsset,
  ]);
  return [
    ...(accounts[0] === null
      ? []
      : [removeInputAssetInstruction({ programId: PROGRAM_ID, admin: admin.toBase58(), mint })]),
    ...(accounts[1] === null
      ? []
      : [
          removeSettlementAssetInstruction({
            programId: PROGRAM_ID,
            admin: admin.toBase58(),
            mint,
          }),
        ]),
  ];
}

async function maybeAdd(
  connection: Connection,
  admin: PublicKey,
  mint: string,
): Promise<readonly TransactionInstruction[]> {
  const addresses = paymentRouterAddresses(PROGRAM_ID, mint);
  const accounts = await connection.getMultipleAccountsInfo([
    addresses.inputAsset,
    addresses.settlementAsset,
  ]);
  return [
    ...(accounts[0] === null
      ? [addInputAssetInstruction({ programId: PROGRAM_ID, admin: admin.toBase58(), mint })]
      : []),
    ...(accounts[1] === null
      ? [addSettlementAssetInstruction({ programId: PROGRAM_ID, admin: admin.toBase58(), mint })]
      : []),
  ];
}

async function sendAndConfirmOverHttp(
  connection: Connection,
  transaction: Transaction,
  admin: Keypair,
): Promise<string> {
  const signature = await connection.sendTransaction(transaction, [admin], {
    preflightCommitment: "confirmed",
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = (await connection.getSignatureStatuses([signature])).value[0];
    if (status?.err !== null && status?.err !== undefined) {
      throw new Error(`Devnet configuration failed: ${JSON.stringify(status.err)}`);
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return signature;
    }
    await Bun.sleep(1_000);
  }
  throw new Error(`Timed out confirming devnet configuration transaction ${signature}`);
}

async function main(): Promise<void> {
  const connection = new Connection(devnetRpcUrl(), "confirmed");
  const admin = await loadAdmin();
  const removals = (
    await Promise.all(
      OBSOLETE_TEST_MINTS.map((mint) => maybeRemove(connection, admin.publicKey, mint)),
    )
  ).flat();
  const tokenAdditions = (
    await Promise.all(
      [USDC_MINT, USDG_MINT, ORCA_DEVNET_USDC_MINT, ORCA_DEVNET_PYUSD_MINT].map((mint) =>
        maybeAdd(connection, admin.publicKey, mint),
      ),
    )
  ).flat();
  const surrogateInputAdditions = (
    await Promise.all(
      [SURROGATE_USDG_MINT, SURROGATE_USDT_MINT].map(async (mint) => {
        const address = paymentRouterAddresses(PROGRAM_ID, mint).inputAsset;
        return (await connection.getAccountInfo(address, "confirmed")) === null
          ? [
              addInputAssetInstruction({
                programId: PROGRAM_ID,
                admin: admin.publicKey.toBase58(),
                mint,
              }),
            ]
          : [];
      }),
    )
  ).flat();
  const nativeInputAddresses = paymentRouterAddresses(PROGRAM_ID, SOLANA_WRAPPED_NATIVE_MINT);
  const nativeInputAddition =
    (await connection.getAccountInfo(nativeInputAddresses.inputAsset, "confirmed")) === null
      ? [
          addInputAssetInstruction({
            programId: PROGRAM_ID,
            admin: admin.publicKey.toBase58(),
            mint: SOLANA_WRAPPED_NATIVE_MINT,
          }),
        ]
      : [];
  const orcaRouter = paymentRouterRouteAddress(PROGRAM_ID, ORCA_WHIRLPOOL_PROGRAM);
  const routerAddition =
    (await connection.getAccountInfo(orcaRouter, "confirmed")) === null
      ? [
          addSwapRouterInstruction({
            programId: PROGRAM_ID,
            admin: admin.publicKey.toBase58(),
            routeProgram: ORCA_WHIRLPOOL_PROGRAM,
          }),
        ]
      : [];
  const instructions = [
    ...removals,
    ...tokenAdditions,
    ...surrogateInputAdditions,
    ...nativeInputAddition,
    ...routerAddition,
  ];

  if (instructions.length === 0) {
    console.log(JSON.stringify({ ok: true, changed: false, programId: PROGRAM_ID }));
    return;
  }

  const signature = await sendAndConfirmOverHttp(
    connection,
    new Transaction().add(...instructions),
    admin,
  );
  console.log(
    JSON.stringify({
      ok: true,
      changed: true,
      signature,
      programId: PROGRAM_ID,
      inputAssets: [
        "SOL (WSOL)",
        USDC_MINT,
        USDG_MINT,
        SURROGATE_USDG_MINT,
        SURROGATE_USDT_MINT,
        ORCA_DEVNET_USDC_MINT,
        ORCA_DEVNET_PYUSD_MINT,
      ],
      settlementAssets: [USDC_MINT, USDG_MINT, ORCA_DEVNET_USDC_MINT, ORCA_DEVNET_PYUSD_MINT],
      swapRouters: [ORCA_WHIRLPOOL_PROGRAM],
    }),
  );
}

await main();

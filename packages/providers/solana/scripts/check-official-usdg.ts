import { AnchorProvider } from "@coral-xyz/anchor";
import { ReadOnlyWallet } from "@orca-so/common-sdk";
import {
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PDAUtil,
  PoolUtil,
  WhirlpoolContext,
} from "@orca-so/whirlpools-sdk";
import {
  ExtensionType,
  getExtensionTypes,
  getMint,
  getTransferFeeConfig,
  getTransferHook,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";

const OFFICIAL_USDG_MINT = new PublicKey("4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7");
const DEVNET_WHIRLPOOLS_CONFIG = new PublicKey("FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR");

const UNIMPLEMENTED_EXTENSION_NAMES: Readonly<Record<number, string>> = {
  16: "ConfidentialTransferFeeConfig",
  17: "ConfidentialTransferFeeAmount",
};

function rpcUrl(): string {
  return process.env.SOLANA_PROVISION_RPC_URL ?? "https://api.devnet.solana.com";
}

function extensionName(extension: ExtensionType): string {
  return (
    ExtensionType[extension] ?? UNIMPLEMENTED_EXTENSION_NAMES[extension] ?? `Unknown(${extension})`
  );
}

async function main(): Promise<void> {
  const connection = new Connection(rpcUrl(), "confirmed");
  const context = WhirlpoolContext.withProvider(
    new AnchorProvider(
      connection,
      new ReadOnlyWallet(PublicKey.default),
      AnchorProvider.defaultOptions(),
    ),
    ORCA_WHIRLPOOL_PROGRAM_ID,
  );
  const mint = await getMint(connection, OFFICIAL_USDG_MINT, "confirmed", TOKEN_2022_PROGRAM_ID);
  const badge = PDAUtil.getTokenBadge(
    ORCA_WHIRLPOOL_PROGRAM_ID,
    DEVNET_WHIRLPOOLS_CONFIG,
    OFFICIAL_USDG_MINT,
  ).publicKey;
  const transferFee = getTransferFeeConfig(mint);
  const transferHook = getTransferHook(mint);
  console.log(
    JSON.stringify({
      network: "solana-devnet",
      mint: OFFICIAL_USDG_MINT.toBase58(),
      tokenProgram: TOKEN_2022_PROGRAM_ID.toBase58(),
      extensions: getExtensionTypes(mint.tlvData).map(extensionName),
      transferFeeBasisPoints: transferFee?.newerTransferFee.transferFeeBasisPoints ?? null,
      transferFeeMaximum: transferFee?.newerTransferFee.maximumFee.toString() ?? null,
      transferHookProgram: transferHook?.programId.equals(PublicKey.default)
        ? null
        : (transferHook?.programId.toBase58() ?? null),
      orcaWhirlpoolsConfig: DEVNET_WHIRLPOOLS_CONFIG.toBase58(),
      orcaTokenBadge: badge.toBase58(),
      orcaTokenBadgeExists: (await connection.getAccountInfo(badge, "confirmed")) !== null,
      orcaPermissionlessSupport: await PoolUtil.isSupportedToken(
        context,
        DEVNET_WHIRLPOOLS_CONFIG,
        OFFICIAL_USDG_MINT,
      ),
    }),
  );
}

await main();

import { expect, test } from "bun:test";
import { REVIEWED_MAINNET_TOKENS } from "@mayarin/chain";
import { isAddress } from "viem";

test("every reviewed token address is a valid EIP-55 checksum address", () => {
  const invalid = Object.entries(REVIEWED_MAINNET_TOKENS).flatMap(([chain, tokens]) =>
    Object.entries(tokens ?? {})
      .filter(([, address]) => !isAddress(address))
      .map(([asset, address]) => `${chain}.${asset} ${address}`),
  );
  expect(invalid).toEqual([]);
});

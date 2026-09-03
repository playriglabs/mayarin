/**
 * The parts of an EIP-3009 token this facilitator touches.
 *
 * Hand-written rather than generated because there is no Mayarin contract here
 * — these are fragments of somebody else's deployed token, and the four entries
 * below are the entire surface. Anything wider would be a claim about a
 * contract we do not own.
 */

import { parseAbi } from "viem";

export const eip3009Abi = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Script, console2} from "forge-std/Script.sol";
import {PayoutBatcher} from "../src/PayoutBatcher.sol";

/// @title DeployPayoutBatcher — batch payouts from any wallet (#295)
/// @notice CREATE2 through the canonical deterministic deployer
///         (0x4e59b44847b379578588920cA78FbF26c0B4956C) with a fixed salt, so the
///         contract has one address on every chain and the backend can name it
///         as a constant rather than a per-chain config value. Re-running on a
///         chain where it already exists is refused by CREATE2 itself.
///
///      Run:
///      ```
///      forge script scripts/DeployPayoutBatcher.s.sol:DeployPayoutBatcher \
///        --rpc-url $ARBITRUM_SEPOLIA_RPC_URL --broadcast --private-key $DEPLOYER_PRIVATE_KEY
///      ```
contract DeployPayoutBatcher is Script {
    bytes32 internal constant SALT = keccak256("mayarin.payout-batcher.v1");

    function run() external returns (PayoutBatcher batcher) {
        vm.startBroadcast();
        batcher = new PayoutBatcher{salt: SALT}();
        vm.stopBroadcast();
        console2.log("PayoutBatcher", address(batcher));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {EscrowFactoryV2} from "../src/EscrowFactoryV2.sol";

/// @title DeployEscrowFactoryV2 — dispute bond and split resolution (RFC #315)
/// @notice Same as v1: CREATE2 through the canonical deterministic deployer
///         with a fixed salt, so the factory has one address on every chain.
///         v1 stays deployed; escrows made under it keep v1's rules.
///
///      Run:
///      ```
///      forge script scripts/DeployEscrowFactoryV2.s.sol:DeployEscrowFactoryV2 \
///        --rpc-url $ARBITRUM_SEPOLIA_RPC_URL --broadcast --private-key $DEPLOYER_PRIVATE_KEY
///      ```
contract DeployEscrowFactoryV2 is Script {
    bytes32 internal constant SALT = keccak256("mayarin.escrow-factory.v2");

    function run() external returns (EscrowFactoryV2 factory) {
        vm.startBroadcast();
        factory = new EscrowFactoryV2{salt: SALT}();
        vm.stopBroadcast();
        console2.log("EscrowFactoryV2", address(factory));
        console2.logBytes32(factory.INIT_CODE_HASH());
    }
}

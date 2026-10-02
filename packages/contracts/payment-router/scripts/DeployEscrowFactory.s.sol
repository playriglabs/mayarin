// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {EscrowFactory} from "../src/EscrowFactory.sol";

/// @title DeployEscrowFactory — conditional settlement (RFC #304)
/// @notice CREATE2 through the canonical deterministic deployer with a fixed
///         salt, so the factory has one address on every chain — and with it,
///         every escrow address is a function of the terms alone. The factory
///         has no constructor arguments and no owner, so nothing about a
///         deployment is chain-specific.
///
///      Run:
///      ```
///      forge script scripts/DeployEscrowFactory.s.sol:DeployEscrowFactory \
///        --rpc-url $ARBITRUM_SEPOLIA_RPC_URL --broadcast --private-key $DEPLOYER_PRIVATE_KEY
///      ```
contract DeployEscrowFactory is Script {
    bytes32 internal constant SALT = keccak256("mayarin.escrow-factory.v1");

    function run() external returns (EscrowFactory factory) {
        vm.startBroadcast();
        factory = new EscrowFactory{salt: SALT}();
        vm.stopBroadcast();
        console2.log("EscrowFactory", address(factory));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {DepositForwarder} from "../src/DepositForwarder.sol";
import {DepositForwarderFactory} from "../src/DepositForwarderFactory.sol";

/// @title DeployDepositForwarderFactory — deterministic deposit addresses (issue #81)
/// @notice Deploys the factory every deposit address on this chain derives from.
///
/// @dev **Deploying this pins `INIT_CODE_HASH`, and every deposit address
///      derives from it.** If `DepositForwarder`'s bytecode changes afterwards,
///      this factory can no longer deploy to any address derived under the old
///      hash — anything a payer already sent there becomes unsweepable. So:
///      finalize the forwarder's bytecode, then deploy this, then derive
///      addresses. A redeploy is not a migration, it is a fork of the address
///      space.
///
///      `DESTINATION` is immutable on the factory for the same reason a mutable
///      one would be indefensible: it is where every deposit ends up, and a
///      setter would let whoever holds the key redirect funds payers have
///      already been told to send.
///
///      Run:
///      ```
///      DESTINATION=0x... forge script \
///        scripts/DeployDepositForwarderFactory.s.sol:DeployDepositForwarderFactory \
///        --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast --verify \
///        --etherscan-api-key $ETHERSCAN_API_KEY --private-key $DEPLOYER_PRIVATE_KEY
///      ```
///
///      Required env:
///        DESTINATION  the operator address every forwarder sweeps to. It pays
///                     the gas for each sweep and each router call, and it is
///                     the one key in the system that can move funds — see the
///                     custody section of docs/threat-model.md.
contract DeployDepositForwarderFactory is Script {
    function run() external returns (DepositForwarderFactory factory) {
        address destination = vm.envAddress("DESTINATION");

        vm.startBroadcast();
        factory = new DepositForwarderFactory(destination);
        vm.stopBroadcast();

        console2.log("DepositForwarderFactory:", address(factory));
        console2.log("destination:            ", destination);
        console2.log("");
        console2.log("INIT_CODE_HASH (config as DEPOSIT_FORWARDER_INIT_CODE_HASH):");
        console2.logBytes32(factory.INIT_CODE_HASH());

        // Asserted rather than merely printed: the off-chain deriver computes
        // deposit addresses from this hash, so a factory whose constant does not
        // match its own forwarder bytecode would hand payers addresses it can
        // never deploy to.
        require(
            factory.INIT_CODE_HASH() == keccak256(type(DepositForwarder).creationCode),
            "INIT_CODE_HASH does not match the deployed forwarder bytecode"
        );

        console2.log("");
        console2.log("Sample deposit addresses (indices 0,1):");
        console2.log(factory.forwarderAddress(keccak256("mayarin.deposit.0")));
        console2.log(factory.forwarderAddress(keccak256("mayarin.deposit.1")));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {ConfigBatch} from "./ConfigurePaymentRouter.s.sol";

/// @title ExecutePaymentRouterConfig — the second half of `ConfigurePaymentRouter`
/// @notice With a real timelock delay `ConfigurePaymentRouter` only schedules the
///         batch. Once the delay has passed this executes it, with the same
///         environment: it rebuilds the identical batch, so it names the same
///         operation.
///
///      It refuses to broadcast until the operation is ready, and says when it will
///      be. Must be sent by the `MULTISIG` (the timelock's executor); when that is a
///      Safe, send the `executeBatch` calldata `ConfigurePaymentRouter` printed
///      instead and use this only to check readiness.
///
///      Run:
///      ```
///      forge script scripts/ExecutePaymentRouterConfig.s.sol:ExecutePaymentRouterConfig \
///        --rpc-url $RPC --broadcast --sender $MULTISIG
///      ```
contract ExecutePaymentRouterConfig is ConfigBatch {
    function run() external {
        TimelockController timelock = TimelockController(payable(vm.envAddress("TIMELOCK")));
        Batch memory b = _batch();

        bytes32 id = timelock.hashOperationBatch(b.targets, b.values, b.payloads, bytes32(0), SALT);
        require(timelock.isOperation(id), "this batch was never scheduled: check the env");
        require(!timelock.isOperationDone(id), "this batch was already executed");

        if (!timelock.isOperationReady(id)) {
            console2.log("Not ready. Executable at (unix):", timelock.getTimestamp(id));
            console2.log("Now (unix):                     ", block.timestamp);
            revert("the timelock delay has not passed yet");
        }

        vm.startBroadcast();
        timelock.executeBatch(b.targets, b.values, b.payloads, bytes32(0), SALT);
        vm.stopBroadcast();

        console2.log("Executed operation:");
        console2.logBytes32(id);
    }
}

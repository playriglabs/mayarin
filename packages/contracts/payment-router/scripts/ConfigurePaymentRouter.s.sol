// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Script, console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";

/// @title ConfigurePaymentRouter — whitelist DEX routers and input assets (issue #29)
/// @notice A freshly deployed `PaymentRouter` cannot process a single payment
///         that needs a swap. The constructor whitelists **settlement assets
///         only**; DEX routers and payer input assets go through `addRouter` /
///         `addInputAsset`, both `onlyRole(CONFIG_ROLE)` — and `CONFIG_ROLE` is
///         held by the `TimelockController`, not by any key. So the first
///         `payEth` after deploy reverts `RouterNotWhitelisted` until this runs.
///
/// @dev Batches every config call into one timelock operation: one `scheduleBatch`
///      now, one `executeBatch` after the delay. Batched rather than one op per
///      call because a half-applied config is a router that admits an input asset
///      it cannot route — and on mainnet each separate op would cost its own
///      48h wait.
///
///      With `TIMELOCK_DELAY=0` (testnet) this schedules *and* executes in one
///      run. With a real delay it schedules and prints the command to execute
///      later, because the operation is not ready yet.
///
///      Must be broadcast by the `MULTISIG` used at deploy: it is the timelock's
///      only proposer and executor.
///
///      Run:
///      ```
///      forge script scripts/ConfigurePaymentRouter.s.sol:ConfigurePaymentRouter \
///        --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast --sender $MULTISIG
///      ```
///
///      Required env:
///        TIMELOCK          the deployed TimelockController
///        PAYMENT_ROUTER    the deployed PaymentRouter
///        DEX_ROUTERS       comma-separated swap routers to admit
///                          (0x AllowanceHolder / Uniswap SwapRouter02)
///        INPUT_ASSETS      comma-separated payer ERC-20s to admit
///                          (empty is valid: native-only accepts no ERC-20 payer)
///        SETTLEMENT_ASSETS comma-separated settlement ERC-20s to admit — a
///                          merchant settling a chain in EURC or PYUSD needs it
///                          here, or every payment into it reverts at CLEARING
/// @dev The batch every config script agrees on. `ConfigurePaymentRouter` schedules
///      it and `ExecutePaymentRouterConfig` executes it; both build it here from the
///      same environment, so the operation id they compute cannot differ.
abstract contract ConfigBatch is Script {
    /// @dev Fixed salt: the operation id is derived from it plus the calls, so a
    ///      re-run with the same config collides — which is the desired
    ///      behaviour, not a bug. Change it to schedule a genuinely new config.
    bytes32 internal constant SALT = keccak256("mayarin.payment-router.config.v1");

    struct Batch {
        address[] targets;
        uint256[] values;
        bytes[] payloads;
        address[] dexRouters;
        address[] inputAssets;
        address[] settlementAssets;
    }

    function _batch() internal view returns (Batch memory b) {
        address routerAddress = vm.envAddress("PAYMENT_ROUTER");
        b.dexRouters = vm.envOr("DEX_ROUTERS", ",", new address[](0));
        b.inputAssets = vm.envOr("INPUT_ASSETS", ",", new address[](0));
        b.settlementAssets = vm.envOr("SETTLEMENT_ASSETS", ",", new address[](0));

        if (b.dexRouters.length == 0 && b.inputAssets.length == 0 && b.settlementAssets.length == 0)
        {
            revert("nothing to configure: set DEX_ROUTERS, INPUT_ASSETS and/or SETTLEMENT_ASSETS");
        }

        uint256 total = b.dexRouters.length + b.inputAssets.length + b.settlementAssets.length;
        b.targets = new address[](total);
        b.values = new uint256[](total);
        b.payloads = new bytes[](total);

        uint256 index = 0;
        for (uint256 i = 0; i < b.dexRouters.length; i += 1) {
            b.targets[index] = routerAddress;
            b.payloads[index] = abi.encodeCall(PaymentRouter.addRouter, (b.dexRouters[i]));
            index += 1;
        }
        for (uint256 i = 0; i < b.inputAssets.length; i += 1) {
            b.targets[index] = routerAddress;
            b.payloads[index] = abi.encodeCall(PaymentRouter.addInputAsset, (b.inputAssets[i]));
            index += 1;
        }
        for (uint256 i = 0; i < b.settlementAssets.length; i += 1) {
            b.targets[index] = routerAddress;
            b.payloads[index] =
                abi.encodeCall(PaymentRouter.addSettlementAsset, (b.settlementAssets[i]));
            index += 1;
        }
    }
}

contract ConfigurePaymentRouter is ConfigBatch {
    function run() external {
        TimelockController timelock = TimelockController(payable(vm.envAddress("TIMELOCK")));
        Batch memory b = _batch();
        uint256 total = b.targets.length;
        uint256 delay = timelock.getMinDelay();

        // What a Safe signs when the multisig is not a single key: the timelock is
        // the `to`, these are the `data`. Printed before anything is broadcast.
        console2.log("Timelock (Safe `to`):", address(timelock));
        console2.log("scheduleBatch calldata:");
        console2.logBytes(
            abi.encodeCall(
                TimelockController.scheduleBatch,
                (b.targets, b.values, b.payloads, bytes32(0), SALT, delay)
            )
        );
        console2.log("executeBatch calldata (send after the delay):");
        console2.logBytes(
            abi.encodeCall(
                TimelockController.executeBatch, (b.targets, b.values, b.payloads, bytes32(0), SALT)
            )
        );

        vm.startBroadcast();
        timelock.scheduleBatch(b.targets, b.values, b.payloads, bytes32(0), SALT, delay);
        // A zero delay makes the operation ready in the same block, which is the
        // point of a short testnet delay: deploy and configure without a wait.
        if (delay == 0) {
            timelock.executeBatch(b.targets, b.values, b.payloads, bytes32(0), SALT);
        }
        vm.stopBroadcast();

        console2.log("Scheduled calls: ", total);
        console2.log("Timelock delay:  ", delay);
        if (delay == 0) {
            console2.log("Executed immediately (zero delay).");
        } else {
            console2.log("NOT executed. After the delay, with the same env:");
            console2.log(
                "  forge script scripts/ExecutePaymentRouterConfig.s.sol:ExecutePaymentRouterConfig \\"
            );
            console2.log("    --rpc-url $RPC --broadcast --sender $MULTISIG");
        }
        for (uint256 i = 0; i < b.dexRouters.length; i += 1) {
            console2.log("DEX router:      ", b.dexRouters[i]);
        }
        for (uint256 i = 0; i < b.inputAssets.length; i += 1) {
            console2.log("Input asset:     ", b.inputAssets[i]);
        }
        for (uint256 i = 0; i < b.settlementAssets.length; i += 1) {
            console2.log("Settlement asset:", b.settlementAssets[i]);
        }
    }
}

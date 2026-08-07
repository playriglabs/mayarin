// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

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
contract ConfigurePaymentRouter is Script {
    /// @dev Fixed salt: the operation id is derived from it plus the calls, so a
    ///      re-run with the same config collides — which is the desired
    ///      behaviour, not a bug. Change it to schedule a genuinely new config.
    bytes32 internal constant SALT = keccak256("mayarin.payment-router.config.v1");

    function run() external {
        address timelockAddress = vm.envAddress("TIMELOCK");
        address routerAddress = vm.envAddress("PAYMENT_ROUTER");
        address[] memory dexRouters = vm.envOr("DEX_ROUTERS", ",", new address[](0));
        address[] memory inputAssets = vm.envOr("INPUT_ASSETS", ",", new address[](0));

        if (dexRouters.length == 0 && inputAssets.length == 0) {
            revert("nothing to configure: set DEX_ROUTERS and/or INPUT_ASSETS");
        }

        TimelockController timelock = TimelockController(payable(timelockAddress));

        uint256 total = dexRouters.length + inputAssets.length;
        address[] memory targets = new address[](total);
        uint256[] memory values = new uint256[](total);
        bytes[] memory payloads = new bytes[](total);

        uint256 index = 0;
        for (uint256 i = 0; i < dexRouters.length; i += 1) {
            targets[index] = routerAddress;
            values[index] = 0;
            payloads[index] = abi.encodeCall(PaymentRouter.addRouter, (dexRouters[i]));
            index += 1;
        }
        for (uint256 i = 0; i < inputAssets.length; i += 1) {
            targets[index] = routerAddress;
            values[index] = 0;
            payloads[index] = abi.encodeCall(PaymentRouter.addInputAsset, (inputAssets[i]));
            index += 1;
        }

        uint256 delay = timelock.getMinDelay();

        vm.startBroadcast();
        timelock.scheduleBatch(targets, values, payloads, bytes32(0), SALT, delay);
        // A zero delay makes the operation ready in the same block, which is the
        // point of a short testnet delay: deploy and configure without a wait.
        if (delay == 0) {
            timelock.executeBatch(targets, values, payloads, bytes32(0), SALT);
        }
        vm.stopBroadcast();

        console2.log("Scheduled calls: ", total);
        console2.log("Timelock delay:  ", delay);
        if (delay == 0) {
            console2.log("Executed immediately (zero delay).");
        } else {
            console2.log("NOT executed. Re-run with the same env after the delay:");
            console2.log("  forge script scripts/ExecutePaymentRouterConfig.s.sol ...");
        }
        for (uint256 i = 0; i < dexRouters.length; i += 1) {
            console2.log("DEX router:      ", dexRouters[i]);
        }
        for (uint256 i = 0; i < inputAssets.length; i += 1) {
            console2.log("Input asset:     ", inputAssets[i]);
        }
    }
}

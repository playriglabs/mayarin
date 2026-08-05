// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";

/// @title DeployPaymentRouter — Base Sepolia deploy script (RFC #4 / issue #29)
/// @notice Present but NOT run. Deploy is deferred to the final stage — after the
///         downstream infra (#5/#6/#8) lands and E2E testing passes — and needs a
///         funded deployer key + RPC + explicit sign-off.
///
/// @dev Deploys the full admin surface in one script: an OZ `TimelockController`
///      (the multisig is proposer + executor + admin) and the `PaymentRouter`
///      wired to it. The router's constructor grants `DEFAULT_ADMIN_ROLE` and
///      `CONFIG_ROLE` to the timelock and `GUARDIAN_ROLE` to the guardian, so no
///      post-deploy role wiring is required — only timelocked config calls
///      (router/input-asset whitelist, feeRecipient, signer).
///
///      Run (when ready):
///      ```
///      forge script scripts/DeployPaymentRouter.s.sol:DeployPaymentRouter \
///        --rpc-url $BASE_SEPOLIA_RPC_URL \
///        --broadcast \
///        --verify \
///        --etherscan-api-key $ETHERSCAN_API_KEY \
///        --sender <deployer>
///      ```
///      Load the env below via `--env-file` or a shell export.
///
///      Required env:
///        MULTISIG          governance multisig — timelock proposer/executor/admin
///        GUARDIAN          instant-pause holder (separate multisig/EOA)
///        FEE_RECIPIENT     treasury destination for `fee`
///        SIGNER            backend quote-signing key (RFC #6 custody: HSM/KMS)
///        SETTLEMENT_TOKEN  settlement ERC-20 (USDC on Base Sepolia — verify the
///                          address on-chain before deploy)
///      Optional env:
///        TIMELOCK_DELAY    config-change delay in seconds (default 48h = 172800;
///                          use a short delay on a fresh testnet, 48h in prod)
///
///      `PERMIT2` is the canonical Uniswap Permit2 address — identical on every
///      chain Uniswap deployed it, including Base Sepolia.
contract DeployPaymentRouter is Script {
    /// @dev Canonical Uniswap Permit2 — same address on every chain where deployed.
    address internal constant PERMIT2 = 0x0000000000001fF3684f28c67538d4D072C22734;

    /// @dev Default config-change delay: 48 hours (production). Override with
    ///      `TIMELOCK_DELAY` for a testnet where a shorter delay is operationally
    ///      convenient.
    uint256 internal constant DEFAULT_DELAY = 48 hours;

    function run() external returns (PaymentRouter router) {
        // Deploy-time identities — rotate per environment, never hardcode.
        address multisig = vm.envAddress("MULTISIG");
        address guardian = vm.envAddress("GUARDIAN");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        address signer = vm.envAddress("SIGNER");
        address settlementToken = vm.envAddress("SETTLEMENT_TOKEN");
        uint256 delay = vm.envOr("TIMELOCK_DELAY", DEFAULT_DELAY);

        vm.startBroadcast();

        // The multisig schedules + executes config ops after `delay`.
        address[] memory proposers = new address[](1);
        proposers[0] = multisig;
        address[] memory executors = new address[](1);
        executors[0] = multisig;
        TimelockController timelock = new TimelockController(delay, proposers, executors, multisig);

        // The router grants DEFAULT_ADMIN + CONFIG_ROLE to `timelock` and
        // GUARDIAN_ROLE to `guardian` in its constructor — no role wiring needed.
        router = new PaymentRouter({
            timelock: address(timelock),
            guardian: guardian,
            feeRecipient_: feeRecipient,
            signer_: signer,
            settlementToken_: settlementToken,
            permit2_: PERMIT2
        });

        vm.stopBroadcast();

        console2.log("TimelockController:", address(timelock));
        console2.log("PaymentRouter:    ", address(router));
        console2.log("Settlement token: ", settlementToken);
        console2.log("Permit2:          ", PERMIT2);

        // Post-deploy config (router/input-asset whitelist, feeRecipient, signer
        // rotation) goes through `timelock.schedule` → `delay` → `timelock.execute`,
        // not here. See packages/contracts/payment-router/README.md §Admin model.
    }
}
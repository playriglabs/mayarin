// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";

/// @title DeployPaymentRouter — Base Sepolia deploy script (RFC #4 / issue #29)
/// @notice Deploys the router and its admin surface. Needs a funded deployer key,
///         an RPC URL, and explicit sign-off.
///
///         **This alone does not give a working router.** The constructor
///         whitelists settlement assets only; DEX routers and payer input assets
///         are timelocked config calls, so run `ConfigurePaymentRouter.s.sol`
///         next or the first swap payment reverts `RouterNotWhitelisted`.
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
///        SETTLEMENT_TOKENS comma-separated settlement ERC-20s, at least one
///                          (e.g. USDC on Base Sepolia — verify the
///                          address on-chain before deploy)
///      Optional env:
///        TIMELOCK_DELAY    config-change delay in seconds (default 48h = 172800).
///                          Set `0` on a testnet: every post-deploy whitelist
///                          waits this long, so the default turns a deploy into a
///                          two-day gate before the first payment can be tested.
///
///      `SIGNER` must be the address the API signs orders with — the router
///      verifies against it, so a mismatch fails every payment with
///      `InvalidSigner`. It is `TURNKEY_SIGNER_ADDRESS`, or the address of
///      `QUOTE_SIGNER_PRIVATE_KEY` when `QUOTE_SIGNER=local`.
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
        // Comma-separated, e.g. SETTLEMENT_TOKENS=0xUSDC,0xIDRX. At least one is
        // required: a router with no admitted settlement asset can serve no
        // payment, and adding one later costs the full timelock delay.
        address[] memory settlementTokens = vm.envAddress("SETTLEMENT_TOKENS", ",");
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
            settlementAssets: settlementTokens,
            permit2_: PERMIT2
        });

        vm.stopBroadcast();

        console2.log("TimelockController:", address(timelock));
        console2.log("PaymentRouter:    ", address(router));
        for (uint256 index = 0; index < settlementTokens.length; index += 1) {
            console2.log("Settlement asset: ", settlementTokens[index]);
        }
        console2.log("Permit2:          ", PERMIT2);

        console2.log("");
        console2.log("NEXT: whitelist DEX routers and input assets, or no swap");
        console2.log("payment can execute. See ConfigurePaymentRouter.s.sol.");

        // Post-deploy config (router/input-asset whitelist, feeRecipient, signer
        // rotation) goes through `timelock.schedule` → `delay` → `timelock.execute`,
        // not here. See packages/contracts/payment-router/README.md §Admin model.
    }
}